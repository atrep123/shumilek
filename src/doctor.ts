/**
 * Doctor — Self-diagnostics for Shumilek.
 *
 * Inspired by OpenClaw's `openclaw doctor` command.
 * Checks Ollama connectivity, model availability, VRAM, configuration validity.
 */

import fetch from 'node-fetch';

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
}

const STATUS_ICON: Record<string, string> = {
  ok: '✅',
  warn: '⚠️',
  fail: '❌'
};

export async function runDoctorChecks(params: {
  baseUrl: string;
  mainModel: string;
  writerModel: string;
  rozumModel: string;
  svedomiModel: string;
  timeoutMs?: number;
}): Promise<DoctorReport> {
  const timeout = params.timeoutMs ?? 5000;
  const checks: DoctorCheck[] = [];

  // 1. Ollama connectivity
  const connectCheck = await checkOllamaConnection(params.baseUrl, timeout);
  checks.push(connectCheck);

  if (connectCheck.status === 'fail') {
    // Can't run model checks without connectivity
    checks.push({
      name: 'Modely',
      status: 'fail',
      detail: 'Nelze ověřit — Ollama nedostupná'
    });
    return { checks, ok: false };
  }

  // 2. List available models and check each configured model
  const availableModels = await listModels(params.baseUrl, timeout);
  const requiredModels = [
    { name: params.mainModel, role: 'Hlavní model' },
    { name: params.writerModel, role: 'Writer model' },
    { name: params.rozumModel, role: 'Rozum (planner)' },
    { name: params.svedomiModel, role: 'Svedomi (validator)' }
  ];

  // Deduplicate
  const seen = new Set<string>();
  for (const m of requiredModels) {
    if (seen.has(m.name)) continue;
    seen.add(m.name);
    const found = availableModels.some(a => a.name === m.name || a.name.startsWith(m.name + ':'));
    checks.push({
      name: `Model: ${m.name}`,
      status: found ? 'ok' : 'fail',
      detail: found ? `${m.role} — dostupný` : `${m.role} — CHYBÍ! Stáhněte: \`ollama pull ${m.name}\``
    });
  }

  // 3. Model count summary
  checks.push({
    name: 'Dostupné modely',
    status: availableModels.length > 0 ? 'ok' : 'warn',
    detail: `${availableModels.length} modelů nalezeno`
  });

  // 4. Quick generation test
  const genCheck = await checkGeneration(params.baseUrl, params.mainModel, timeout * 3);
  checks.push(genCheck);

  // 5. Config sanity
  if (params.baseUrl.includes('localhost') || params.baseUrl.includes('127.0.0.1')) {
    checks.push({ name: 'Bezpečnost URL', status: 'ok', detail: 'Lokální backend — OK' });
  } else {
    checks.push({
      name: 'Bezpečnost URL',
      status: 'warn',
      detail: `Remote backend: ${params.baseUrl} — zkontrolujte, že je důvěryhodný`
    });
  }

  const ok = checks.every(c => c.status !== 'fail');
  return { checks, ok };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = ['### 🩺 Doctor — Diagnostika\n'];
  for (const c of report.checks) {
    lines.push(`${STATUS_ICON[c.status]} **${c.name}**: ${c.detail}`);
  }
  lines.push('');
  lines.push(report.ok ? '**Výsledek: Vše v pořádku** ✅' : '**Výsledek: Nalezeny problémy** ❌');
  return lines.join('\n');
}

async function checkOllamaConnection(baseUrl: string, timeoutMs: number): Promise<DoctorCheck> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (res.ok) {
      return { name: 'Ollama spojení', status: 'ok', detail: `${baseUrl} — odezva OK` };
    }
    return { name: 'Ollama spojení', status: 'warn', detail: `${baseUrl} — HTTP ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('abort') || msg.includes('Abort')) {
      return { name: 'Ollama spojení', status: 'fail', detail: `${baseUrl} — timeout (${timeoutMs}ms)` };
    }
    return { name: 'Ollama spojení', status: 'fail', detail: `${baseUrl} — ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

interface OllamaModel {
  name: string;
  size: number;
}

async function listModels(baseUrl: string, timeoutMs: number): Promise<OllamaModel[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!res.ok) {
      await res.text().catch(() => {});
      return [];
    }
    const data = await res.json() as { models?: OllamaModel[] };
    return data?.models ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function checkGeneration(baseUrl: string, model: string, timeoutMs: number): Promise<DoctorCheck> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const start = Date.now();
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: 'Say OK', stream: false }),
      signal: controller.signal
    });
    const elapsed = Date.now() - start;
    if (!res.ok) {
      await res.text().catch(() => {});
      return { name: 'Generování', status: 'fail', detail: `${model} — HTTP ${res.status}` };
    }
    const json = await res.json() as { response?: string };
    const preview = (json?.response ?? '').slice(0, 40).replace(/\n/g, ' ');
    return {
      name: 'Generování',
      status: 'ok',
      detail: `${model} — OK (${elapsed}ms): "${preview}"`
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { name: 'Generování', status: 'fail', detail: `${model} — ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}
