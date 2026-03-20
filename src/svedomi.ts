// SvedomiValidator module - Mini-model based quality validation
// Exported for testing and modular use

import type { MiniModelResult, Task } from './types';
import fetch, { Headers } from 'node-fetch';
import * as crypto from 'crypto';

type OutputChannel = { appendLine: (msg: string) => void } | undefined;
type GuardianStatsRef = { miniModelValidations: number; miniModelRejections: number };

let logChannel: OutputChannel = undefined;
let statsRef: GuardianStatsRef | null = null;
let tasksDatabaseRef: Task[] = [];

export function setSvedomiLogger(channel: OutputChannel): void {
  logChannel = channel;
}

export function setSvedomiStats(stats: GuardianStatsRef): void {
  statsRef = stats;
}

export function setSvedomiTasks(tasks: Task[]): void {
  tasksDatabaseRef = tasks;
}

export class SvedomiValidator {
  private baseUrl: string = 'http://localhost:11434';
  private model: string = 'qwen2.5:3b';
  private enabled: boolean = true;
  private timeout: number = 120000; // 2 minutes for thorough validation
  
  private validationCache: Map<string, { result: MiniModelResult; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 60000;
  private readonly CACHE_MAX_SIZE = 500;

  /** Prefer a globally injected fetch (for tests) and fallback to node-fetch */
  private getFetch(): typeof fetch {
    return (globalThis as any).fetch ?? fetch;
  }

  /** Prefer globally injected Headers (for tests) and fallback to node-fetch */
  private getHeaders(): typeof Headers {
    return (globalThis as any).Headers ?? Headers;
  }

  configure(baseUrl: string, model: string, enabled: boolean): void {
    this.baseUrl = baseUrl;
    this.model = model;
    this.enabled = enabled;
    logChannel?.appendLine(`[Svedomi] Konfigurace: model=${model}, enabled=${enabled}`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getModel(): string {
    return this.model;
  }

  private getCacheKey(prompt: string, response: string): string {
    const combined = prompt.slice(0, 200) + '|' + response.slice(0, 500);
    return crypto.createHash('sha256').update(combined).digest('hex').slice(0, 16);
  }

  private checkCache(key: string): MiniModelResult | null {
    const cached = this.validationCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      logChannel?.appendLine(`[Svedomi] Cache hit - score: ${cached.result.score}/10`);
      return cached.result;
    }
    if (cached) {
      this.validationCache.delete(key);
    }
    return null;
  }

  private evictStaleEntries(): void {
    const now = Date.now();
    for (const [k, v] of this.validationCache) {
      if (now - v.timestamp >= this.CACHE_TTL) {
        this.validationCache.delete(k);
      }
    }
    if (this.validationCache.size > this.CACHE_MAX_SIZE) {
      const excess = this.validationCache.size - this.CACHE_MAX_SIZE;
      const keysToDelete = Array.from(this.validationCache.keys()).slice(0, excess);
      for (const k of keysToDelete) {
        this.validationCache.delete(k);
      }
    }
  }

  clearCache(): void {
    this.validationCache.clear();
    logChannel?.appendLine('[Svedomi] Cache cleared');
  }

  /**
   * Parse mini-model response into structured result
   */
  parseValidationResponse(output: string): MiniModelResult {
    if (!output || output.trim().length === 0) {
      logChannel?.appendLine('[Svedomi] Prázdná odpověď od mini-modelu');
      return {
        isValid: false,
        score: 0,
        reason: 'Mini-model nevratil odpoved',
        shouldRetry: false,
        unavailable: true,
        errorCode: 'empty_output'
      };
    }

    const lines = output.toUpperCase();

    const scoreMatch = lines.match(/SK\W*O?\W*RE:\s*(\d+)/i) || lines.match(/SCORE:\s*(\d+)/i);
    let score = 5;
    if (scoreMatch) {
      const parsed = parseInt(scoreMatch[1], 10);
      if (!Number.isNaN(parsed)) {
        score = Math.min(10, Math.max(1, parsed));
      }
    }

    const validMatch = lines.match(/VALIDN\W*I?:\s*(ANO|NE|YES|NO)/i) || lines.match(/VALID:\s*(ANO|NE|YES|NO)/i);
    const isValid = validMatch
      ? (validMatch[1] === 'ANO' || validMatch[1] === 'YES')
      : score >= 5;

    const reasonMatch = output.match(/D\W*VOD:\s*(.+)/i) || output.match(/REASON:\s*(.+)/i);
    const reason = reasonMatch
      ? reasonMatch[1].trim().slice(0, 100)
      : (isValid ? 'Odpověď je v pořádku' : 'Odpověď nesplňuje kritéria');

    const shouldRetry = score <= 3;

    return { isValid, score, reason, shouldRetry };
  }




  /**
   * Main validation entry point
   */
  async validate(userPrompt: string, response: string, onStatus?: (status: string) => void): Promise<MiniModelResult> {
    // 1. Validate inputs
    const inputCheck = this.validateInputs(userPrompt, response);
    if (inputCheck) {
      return inputCheck;
    }

    // 2. Check cache
    const cached = this.getCachedResult(userPrompt, response);
    if (cached) {
      return cached;
    }

    // 3. Prepare Prompt
    const validationPrompt = this.buildValidationPrompt(userPrompt, response, tasksDatabaseRef);
    
    // 4. Update stats
    if (statsRef) {
      statsRef.miniModelValidations++;
    }

    // 5. Call API
    try {
      onStatus?.('Svedomi analyzuje odpoved...');
      const fetchFn = this.getFetch();
      const HeadersCtor = this.getHeaders();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const res = await fetchFn(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: new HeadersCtor({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          model: this.model,
          prompt: validationPrompt,
          stream: false,
          options: {
            temperature: 0.1,
            num_predict: 200,
            top_p: 0.9
          }
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (!res.ok) {
        logChannel?.appendLine(`[Svedomi] Error: ${res.status} ${res.statusText}`);
        const isTransient = res.status >= 500 || res.status === 429;
        return {
          isValid: false,
          score: 0,
          reason: `Validation API failed (HTTP ${res.status})`,
          shouldRetry: isTransient,
          unavailable: true,
          errorCode: `http_${res.status}`
        };
      }

      const data = await res.json() as { response?: string };
      const output = data?.response || '';
      
      // 6. Parse and Cache
      const result = this.parseValidationResponse(output);
      this.cacheResult(userPrompt, response, result);
      
      if (!result.isValid && statsRef) {
        statsRef.miniModelRejections++;
      }

      return result;

    } catch (err: unknown) {
      const error = err as Error;
      if (error.name === 'AbortError') {
         logChannel?.appendLine('[Svedomi] Timeout pri validaci');
      } else {
         logChannel?.appendLine(`[Svedomi] Exception: ${error.message || String(err)}`);
      }
      return {
        isValid: false,
        score: 0,
        reason: error.name === 'AbortError' ? 'Validation timeout' : 'Validation exception',
        shouldRetry: true,
        unavailable: true,
        errorCode: error.name === 'AbortError' ? 'timeout' : 'exception'
      };
    }
  }

  /**
   * Validate empty or missing inputs (without calling API)
   */
  validateInputs(userPrompt: string, response: string): MiniModelResult | null {
    if (!this.enabled) {
      return { isValid: true, score: 10, reason: 'Mini-model vypnut', shouldRetry: false };
    }

    if (!response || response.trim().length === 0) {
      return { isValid: false, score: 1, reason: 'Prázdná odpověď', shouldRetry: true };
    }

    if (!userPrompt || userPrompt.trim().length === 0) {
      return { isValid: true, score: 7, reason: 'Nelze validovat bez dotazu', shouldRetry: false };
    }

    return null;
  }



  /**
   * Check cache for existing validation result
   */
  getCachedResult(userPrompt: string, response: string): MiniModelResult | null {
    const cacheKey = this.getCacheKey(userPrompt, response);
    return this.checkCache(cacheKey);
  }

  /**
   * Store result in cache
   */
  cacheResult(userPrompt: string, response: string, result: MiniModelResult): void {
    const cacheKey = this.getCacheKey(userPrompt, response);
    this.validationCache.set(cacheKey, { result, timestamp: Date.now() });
    this.evictStaleEntries();
  }

  /**
   * Build validation prompt for mini-model
   */
  buildValidationPrompt(userPrompt: string, response: string, relevantTasks: Task[] = []): string {
    const truncatedResponse = response.slice(0, 6000); // More context for thorough validation
    const truncatedPrompt = userPrompt.slice(0, 2500);

    const tasksInstruction = relevantTasks.length > 0
      ? `\nCHECK SPECIFIC TASKS:\n${relevantTasks.map(t => `- ${t.title} (Weight: ${t.weight})`).join('\n')}`
      : '';

    return `You are an AI quality validator named "Svedomi". Analyze the given answer strictly against the user prompt.

USER PROMPT:
${truncatedPrompt}

AI ANSWER TO EVALUATE:
${truncatedResponse}
${tasksInstruction}

EVALUATION CRITERIA (STRICT):
1. Relevance - Does it directly address the prompt without evasiveness?
2. Completeness - Are all aspects covered?
3. Grammar/Formatting - Is it free of syntax errors or bad Markdown?
4. Hallucinations - Did it make up APIs, files, or facts not present?
5. Clarity - Is it logical and concise?

SCORING SCALE:
10 = Perfect
7-9 = Good, minor issues
5-6 = Acceptable, noticeable flaws
3-4 = Bad, requires rewrite
1-2 = Completely wrong

YOU MUST RESPOND ONLY IN THIS EXACT FORMAT - NO OTHER TEXT:
SKORE: [1-10]
VALIDNI: [ANO/NE]
DUVOD: [Short reasoning in exactly 1 sentence explaining the flaws]`;
  }
}


