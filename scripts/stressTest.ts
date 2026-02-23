import { Headers, Response } from 'node-fetch';
import { Rozum, ActionStep, RozumPlan, setRozumLogger } from '../src/rozum';
import { ChatMessage } from '../src/types';

// Simple sleep helper
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Mock plan output that Rozum.parsePlan understands
function buildMockPlan(): string {
  return `SLOŽITOST: complex

KROK 1:
TYP: ANALYZE
NÁZEV: Projdi src
INSTRUKCE: Projdi všechny TS soubory v src a popiš možné chyby, zapiš čísla řádků a funkce.

KROK 2:
TYP: ANALYZE
NÁZEV: Projdi testy
INSTRUKCE: Zkontroluj testy a hledej nedostatky nebo chybějící případy, navrhni nové scénáře.

KROK 3:
TYP: ANALYZE
NÁZEV: Build pipeline
INSTRUKCE: Zjisti možné body selhání v build/lint pipeline (tsc, eslint) a návrhy na stabilizaci.

KROK 4:
TYP: ANALYZE
NÁZEV: Výkonnost
INSTRUKCE: Vyhledej místa kde by mohly vznikat dlouhé odezvy (síťové volání, časové limity) a popiš mitigace.

KROK 5:
TYP: CODE
NÁZEV: Oprav analyzovane chyby
INSTRUKCE: Navrhni konkrétní opravy pro nalezené problémy v src (přesné řádky, co změnit a proč).

KROK 6:
TYP: CODE
NÁZEV: Zlepši testy
INSTRUKCE: Navrhni nové testy pro kritické cesty a doplň chybějící asserty.

KROK 7:
TYP: COMPILE
NÁZEV: Ověř build a lint
INSTRUKCE: Proveď mentální simulaci tsc a eslint, popiš očekávané chyby/varování a jak je řešit.

KROK 8:
TYP: TEST
NÁZEV: Mentální test run
INSTRUKCE: Mentálně spusť testy, popiš jak by se chovaly nové testy a jak validovat výsledky.`;
}

// Install a global fetch mock that distinguishes planning vs. review requests
(global as any).Headers = Headers;
(global as any).Response = Response;

// Track per-step review attempts to simulate reject-then-accept and hard-fail flows
const reviewAttempts = new Map<string, number>();

(global as any).fetch = async (_url: string, options?: { body?: string }) => {
  const parsed = options?.body ? JSON.parse(options.body) : {};
  const prompt: string = parsed?.prompt ?? '';

  // Planning call: return the complex mock plan
  if (prompt.includes('SLOŽITOST') || prompt.includes('plánovací agent')) {
    const body = JSON.stringify({ response: buildMockPlan() });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Review call: simulate one rejection for the "Oprav analyzovane chyby" step, always reject for
  // "Ověř build a lint" (to hit max retry), and accept others
  const isReview = prompt.includes('kontroluješ kvalitu') || prompt.includes('SCHVÁLENO');
  if (isReview) {
    const rejectOnceStep = prompt.includes('Oprav analyzovane chyby');
    const rejectAlwaysStep = prompt.includes('Ověř build a lint');
    const key = rejectOnceStep ? 'Oprav analyzovane chyby' : rejectAlwaysStep ? 'Ověř build a lint' : 'generic';
    const attempts = reviewAttempts.get(key) ?? 0;

    if (rejectOnceStep && attempts === 0) {
      reviewAttempts.set(key, attempts + 1);
      const body = JSON.stringify({
        response: 'SCHVÁLENO: NE\nDŮVOD: Chybí konkrétní diff a řádky.\nOPRAVA: Uveď přesné řádky, funkce a navržené změny.'
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (rejectAlwaysStep) {
      reviewAttempts.set(key, attempts + 1);
      const body = JSON.stringify({
        response: 'SCHVÁLENO: NE\nDŮVOD: Neprošel lint/build mentální kontrolou.\nOPRAVA: Popsat konkrétní očekávané chyby z tsc/eslint a jejich opravy.'
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const body = JSON.stringify({ response: 'SCHVÁLENO: ANO\nDŮVOD: OK\nOPRAVA: žádná' });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Default fallback (should not be hit often)
  const body = JSON.stringify({ response: 'SCHVÁLENO: ANO\nDŮVOD: default\nOPRAVA: žádná' });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
};

async function main() {
  const rozum = new Rozum();
  setRozumLogger({ appendLine: (msg: string) => console.log(msg) });

  const userPrompt = process.env.STRESS_PROMPT
    || process.argv.slice(2).join(' ').trim()
    || 'Potřebuji extrémně komplexní pomalý audit: projdi celý src/, test/, build/lint pipeline, najdi výkonnostní rizika, navrhni opravy, nové testy a popiš mentální build+test průběh.';
  const conversationHistory: ChatMessage[] = [];

  console.log('--- Planning ---');
  const plan: RozumPlan = await rozum.plan(userPrompt, conversationHistory, status => console.log(`[status] ${status}`));
  console.log(`Plan steps: ${plan.steps.length}`);
  plan.steps.forEach(s => console.log(` - (${s.type}) ${s.title}`));

  console.log('\n--- Execute Step by Step ---');
  const svědomíAttempts = new Map<number, number>();
  const results = await rozum.executeStepByStep(
    plan,
    userPrompt,
    async (stepPrompt: string, stepInfo: ActionStep) => {
      console.log(`\n[execute] ${stepInfo.title}`);
      console.log(stepPrompt.slice(0, 200) + '...');
      await delay(250); // simulate work
      return `Výsledek pro ${stepInfo.title} (simulace).`;
    },
    (step, idx, total) => console.log(`[start] ${step.title} (${idx + 1}/${total})`),
    (step, result) => console.log(`[complete] ${step.title} -> ${result.slice(0, 60)}...`),
    (step, approved, feedback) => console.log(`[review] ${step.title} approved=${approved} feedback=${feedback}`),
    async (step) => {
      const prev = svědomíAttempts.get(step.id) ?? 0;
      // Simulate one Svědomí rejection for step 6 on the first attempt
      if (step.id === 6 && prev === 0) {
        svědomíAttempts.set(step.id, prev + 1);
        return { approved: false, reason: 'Svědomí simulace: chybí edge-case test pro null vstup.' };
      }
      // Simulate persistent Svědomí rejection for step 8 to hit max retry path
      if (step.id === 8 && prev < 6) {
        svědomíAttempts.set(step.id, prev + 1);
        return { approved: false, reason: 'Svědomí simulace: chybí validace retry limitu a varování.' };
      }
      svědomíAttempts.set(step.id, prev + 1);
      return { approved: true, reason: 'Simulováno - OK' };
    },
    status => console.log(`[pipeline] ${status}`)
  );

  console.log('\n--- Results ---');
  results.forEach((r, i) => console.log(`Step ${i + 1}: ${r}`));
  console.log('\nStress test finished successfully.');
}

main().catch(err => {
  console.error('Stress test failed:', err);
  process.exit(1);
});
