// SvedomiValidator module - Mini-model based quality validation
// Exported for testing and modular use

import type { MiniModelResult, Task } from './types';
import fetch, { Headers } from 'node-fetch';

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
    const combined = (prompt.slice(0, 100) + response.slice(0, 200)).toLowerCase();
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      hash = ((hash << 5) - hash) + combined.charCodeAt(i);
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  private checkCache(key: string): MiniModelResult | null {
    const cached = this.validationCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      logChannel?.appendLine(`[Svedomi] Cache hit - score: ${cached.result.score}/10`);
      return cached.result;
    }
    return null;
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
      if (!isNaN(parsed)) {
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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: new Headers({ 'Content-Type': 'application/json' }),
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
        return {
          isValid: false,
          score: 0,
          reason: 'Validation API failed',
          shouldRetry: false,
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
        reason: 'Validation exception',
        shouldRetry: false,
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
  }

  /**
   * Build validation prompt for mini-model
   */
  buildValidationPrompt(userPrompt: string, response: string, relevantTasks: Task[] = []): string {
    const truncatedResponse = response.slice(0, 2000); // More context for thorough validation
    const truncatedPrompt = userPrompt.slice(0, 600);

    const tasksInstruction = relevantTasks.length > 0 
      ? `\nKONTROLUJ SPECIFICKE UKOLY:\n${relevantTasks.map(t => `- ${t.title} (Hmotnost: ${t.weight})`).join('\n')}`
      : '';

    return `Jsi validator kvality AI odpovedi jmenem "Svedomi". Analyzuj odpoved a ohodnot ji prisne.

UZIVATELUV DOTAZ:
${truncatedPrompt}

AI ODPOVED:
${truncatedResponse}
${tasksInstruction}

KRITERIA HODNOCENI (PRISNA KONTROLA):
1. Relevance - odpovida presne na dotaz? Neni to vyhybave?
2. Uplnost - jsou vsechny aspekty dotazu pokryte?
3. Gramatika - je text bez preklepu a gramatickych chyb? (KRITICKE)
4. Kvalita - neobsahuje smycky, opakovani nebo halucinace?
5. Srozumitelnost - je odpoved jasna a logicka?
6. Konkretnost - jsou uvedeny konkretni detaily (cisla radku, nazvy souboru)?

SKALA HODNOCENI:
10 = Perfektni, bez chyb
7-9 = Velmi dobre, drobne nedostatky
5-6 = Prijatelne, ale ma problemy
3-4 = Spatne, vyzaduje opravu
1-2 = Zcela nevyhovujici

PRIKLADY CHYB (sniz skore):
- Preklepy nebo gramaticke chyby
- Vagni formulace bez konkretni odpovedi
- Nekompletnost: odpoved jen na cast dotazu

ODPOVEZ POUZE V TOMTO FORMATU:
SKORE: [1-10]
VALIDNI: [ANO/NE]
DUVOD: [konkretni vysvetleni max 30 slov - CO PRESNE je spatne a KDE]`;
  }
}


