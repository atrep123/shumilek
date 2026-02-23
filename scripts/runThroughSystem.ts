import fetch, { Headers } from 'node-fetch';
import { Rozum, setRozumLogger, ActionStep, RozumPlan } from '../src/rozum';
import { ResponseGuardian, setGuardianLogger } from '../src/guardian';
import { HallucinationDetector, setHallucinationLogger } from '../src/hallucination';
import { SvědomiValidator, setSvědomiLogger } from '../src/svedomi';
import type { ChatMessage } from '../src/types';

type OllamaChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function envNumber(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function envString(name: string, fallback: string): string {
  const v = process.env[name];
  return (typeof v === 'string' && v.trim()) ? v.trim() : fallback;
}

async function ollamaChat(
  baseUrl: string,
  model: string,
  messages: OllamaChatMessage[],
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ model, stream: false, messages }),
      signal: controller.signal
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Ollama /api/chat failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
    }

    const json = await res.json() as any;
    const content = json?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('Ollama /api/chat: missing message.content');
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

function buildFinalPrompt(originalPrompt: string, stepResults: string[]): string {
  const stepsBlock = stepResults.length
    ? `\n\nKONTEXT (výsledky kroků):\n${stepResults.map((r, i) => `Krok ${i + 1}: ${r.slice(0, 1200)}`).join('\n\n')}`
    : '';

  return `PŮVODNÍ DOTAZ:\n${originalPrompt}\n${stepsBlock}\n\nNapiš finální odpověď pro uživatele. Buď konkrétní, věcný a strukturovaný.`;
}

function overallOk(
  guardianIssues: string[],
  guardianShouldRetry: boolean,
  svedomi: { isValid: boolean; score: number; shouldRetry: boolean },
  hallucinationConfidence: number
): boolean {
  if (guardianShouldRetry) return false;
  if (guardianIssues.length > 0) return false;
  if (!svedomi.isValid) return false;
  if (svedomi.shouldRetry) return false;
  if (hallucinationConfidence >= 0.5) return false;
  return true;
}

async function runOnce(prompt: string): Promise<void> {
  const baseUrl = envString('SHUMILEK_BASE_URL', 'http://localhost:11434');
  const brainModel = envString('SHUMILEK_BRAIN_MODEL', 'deepseek-coder-v2:16b');
  const writerModel = envString('SHUMILEK_WRITER_MODEL', brainModel);
  const rozumModel = envString('SHUMILEK_ROZUM_MODEL', 'deepseek-r1:8b');
  const miniModel = envString('SHUMILEK_MINI_MODEL', 'qwen2.5:3b');

  const timeoutMs = envNumber('SHUMILEK_TIMEOUT_MS', 120_000);
  const on = (envString('SHUMILEK_ENABLED', 'true').toLowerCase() !== 'false');

  const conversationHistory: ChatMessage[] = [];

  // Loggers
  setRozumLogger({ appendLine: (msg: string) => console.log(msg) });
  setGuardianLogger((msg: string) => console.log(msg));
  setHallucinationLogger((msg: string) => console.log(msg));
  setSvědomiLogger({ appendLine: (msg: string) => console.log(msg) });

  const rozum = new Rozum();
  rozum.configure(baseUrl, rozumModel, on, false);

  const svedomi = new SvědomiValidator();
  svedomi.configure(baseUrl, miniModel, on);

  const guardian = new ResponseGuardian();
  const hallucination = new HallucinationDetector();

  console.log('\n==============================');
  console.log('PROMPT');
  console.log('------------------------------');
  console.log(prompt);

  console.log('\n==============================');
  console.log('ROZUM: PLÁN');
  console.log('------------------------------');
  const plan: RozumPlan = await rozum.plan(prompt, conversationHistory, status => console.log(`[status] ${status}`));
  console.log(`Plan steps: ${plan.steps.length}`);
  plan.steps.forEach(s => console.log(` - (${s.type}) ${s.title}`));

  let stepResults: string[] = [];

  if (plan.shouldPlan && plan.steps.length > 0) {
    console.log('\n==============================');
    console.log('ROZUM: EXECUTE STEP-BY-STEP');
    console.log('------------------------------');

    stepResults = await rozum.executeStepByStep(
      plan,
      prompt,
      async (stepPrompt: string, stepInfo: ActionStep) => {
        console.log(`\n[execute] ${stepInfo.id}/${plan.totalSteps} ${stepInfo.title} (${stepInfo.type})`);
        const content = await ollamaChat(
          baseUrl,
          writerModel,
          [
            { role: 'system', content: 'Jsi pomocný asistent pro programování. Odpovídej česky, konkrétně a věcně.' },
            { role: 'user', content: stepPrompt }
          ],
          timeoutMs
        );
        return content.trim();
      },
      (step, idx, total) => console.log(`[start] ${step.title} (${idx + 1}/${total})`),
      (step, result) => console.log(`[complete] ${step.title} -> ${result.slice(0, 80).replace(/\s+/g, ' ')}...`),
      (step, approved, feedback) => console.log(`[review] ${step.title} approved=${approved} feedback=${feedback}`),
      async (step, result) => {
        const r = await svedomi.validate(step.instruction, result, st => console.log(`[svědomí] ${st}`));
        return { approved: r.isValid, reason: `score=${r.score}/10; ${r.reason}` };
      },
      status => console.log(`[pipeline] ${status}`)
    );
  }

  console.log('\n==============================');
  console.log('FINÁLNÍ ODPOVĚĎ (SYSTEM)');
  console.log('------------------------------');

  const finalPrompt = buildFinalPrompt(prompt, stepResults);

  let finalResponse = '';
  let finalGuardian = null as any;
  let finalHall = null as any;
  let finalSvedomi = null as any;

  for (let attempt = 1; attempt <= 2; attempt++) {
    console.log(`\n[final] Generuju odpověď (pokus ${attempt}/2) model=${writerModel}`);

    const draft = await ollamaChat(
      baseUrl,
      writerModel,
      [
        { role: 'system', content: 'Jsi pomocný asistent pro programování. Odpovídej česky, strukturovaně, bez balastu.' },
        { role: 'user', content: finalPrompt + (attempt === 1 ? '' : '\n\nOPRAV PŘEDCHOZÍ CHYBY: odstraň opakování, buď konkrétnější, nepřidávej vymyšlené detaily.') }
      ],
      timeoutMs
    );

    const cleaned = draft.trim();
    const g = guardian.analyze(cleaned, prompt);
    const h = hallucination.analyze(g.cleanedResponse, prompt, conversationHistory);
    const s = await svedomi.validate(prompt, g.cleanedResponse, st => console.log(`[svědomí] ${st}`));

    finalResponse = g.cleanedResponse;
    finalGuardian = g;
    finalHall = h;
    finalSvedomi = s;

    console.log('\n--- Guardian ---');
    console.log(`isOk=${g.isOk} shouldRetry=${g.shouldRetry} loopDetected=${g.loopDetected} repetitionScore=${g.repetitionScore.toFixed(3)}`);
    if (g.issues.length > 0) console.log(`issues: ${g.issues.join(' | ')}`);

    console.log('\n--- Hallucination ---');
    console.log(`isHallucination=${h.isHallucination} confidence=${h.confidence.toFixed(3)} category=${h.category}`);
    if (h.reasons.length > 0) console.log(`reasons: ${h.reasons.join(' | ')}`);

    console.log('\n--- Svědomí ---');
    console.log(`isValid=${s.isValid} score=${s.score}/10 shouldRetry=${s.shouldRetry} reason=${s.reason}`);

    const ok = overallOk(g.issues, g.shouldRetry, s, h.confidence);
    console.log(`\n[final] OK=${ok}`);
    if (ok) break;
  }

  console.log('\n==============================');
  console.log('FINÁLNÍ TEXT');
  console.log('------------------------------');
  console.log(finalResponse);

  console.log('\n==============================');
  console.log('SHRNUTÍ VYHODNOCENÍ');
  console.log('------------------------------');
  console.log(`Guardian: ok=${finalGuardian?.isOk} issues=${finalGuardian?.issues?.length ?? 0}`);
  console.log(`Hallucination: confidence=${finalHall?.confidence?.toFixed?.(3) ?? 'n/a'} isHallucination=${finalHall?.isHallucination}`);
  console.log(`Svědomí: isValid=${finalSvedomi?.isValid} score=${finalSvedomi?.score}/10`);
}

async function main() {
  const promptsFromArgs = process.argv.slice(2).join(' ').trim();
  const envPrompt = (process.env.SYSTEM_PROMPT || '').trim();

  const prompt = promptsFromArgs || envPrompt;

  const defaultPrompts = [
    'Navrhni bezpečnostní audit tohoto VS Code extension projektu: úniky tokenů, input validation, SSRF přes baseUrl, a návrh mitigací + testy.',
    'Proveď výkonový audit: kde může vznikat latency (timeouts, streaming, retry smyčky). Navrhni měření a optimalizace.',
    'Navrhni refaktor: oddělit pipeline logiku z extension.ts do samostatného modulu, zachovat API, a doplnit jednotkové testy.'
  ];

  if (!prompt) {
    for (const p of defaultPrompts) {
      await runOnce(p);
    }
    return;
  }

  await runOnce(prompt);
}

main().catch(err => {
  console.error('runThroughSystem failed:', err);
  process.exit(1);
});
