// Rozum module - Planning and reasoning agent
// Exported for testing and modular use

import type { ChatMessage } from './types';
import fetch, { Headers } from 'node-fetch';

// Step types for planning
export type StepType = 
  | 'analyze'
  | 'install'
  | 'code'
  | 'compile'
  | 'test'
  | 'explain'
  | 'refactor'
  | 'debug'
  | 'document'
  | 'review'
  | 'other';

export interface ActionStep {
  id: number;
  type: StepType;
  title: string;
  instruction: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: string;
  dependencies?: number[];
}

export interface RozumPlan {
  shouldPlan: boolean;
  complexity: 'simple' | 'medium' | 'complex';
  steps: ActionStep[];
  warnings: string[];
  suggestedApproach: string;
  estimatedLength: 'short' | 'medium' | 'long';
  totalSteps: number;
}

type OutputChannel = { appendLine: (msg: string) => void } | undefined;

let logChannel: OutputChannel = undefined;

export function setRozumLogger(channel: OutputChannel): void {
  logChannel = channel;
}

export class Rozum {
  private baseUrl: string = 'http://localhost:11434';
  private model: string = 'deepseek-r1:8b';
  private enabled: boolean = true;
  private forcePlan: boolean = false;
  private timeout: number = 300000; // 5 minut per step (was 25s)
  private minPromptLength: number = 30;
  private currentPlanSteps: number = 0;

  /** Prefer a globally injected fetch (for tests) and fallback to node-fetch */
  private getFetch(): typeof fetch {
    return (globalThis as any).fetch ?? fetch;
  }

  /** Prefer globally injected Headers (for tests) and fallback to node-fetch */
  private getHeaders(): typeof Headers {
    return (globalThis as any).Headers ?? Headers;
  }

  configure(baseUrl: string, model: string, enabled: boolean, forcePlan: boolean): void {
    this.baseUrl = baseUrl;
    this.model = model;
    this.enabled = enabled;
    this.forcePlan = forcePlan;
    // Massive timeout for deep thinking
    this.timeout = 300000;
    logChannel?.appendLine(`[Rozum] Konfigurace: model=${model}, enabled=${enabled}, timeout=5min`);
  }

  /**
   * Analyze prompt and create execution plan with actionable steps
   */
  async plan(
    userPrompt: string,
    conversationHistory: ChatMessage[],
    onStatus?: (status: string) => void
  ): Promise<RozumPlan> {
    const defaultPlan: RozumPlan = {
      shouldPlan: false,
      complexity: 'simple',
      steps: [],
      warnings: [],
      suggestedApproach: 'PĹ™Ă­mĂˇ odpovÄ›ÄŹ',
      estimatedLength: 'short',
      totalSteps: 0
    };

    if (!this.enabled) {
      logChannel?.appendLine('[Rozum] âŹ¸ď¸Ź Rozum je vypnut');
      return defaultPlan;
    }

    // Skip planning for short prompts
    if (!this.shouldTriggerPlanning(userPrompt)) {
      logChannel?.appendLine(`[Rozum] âŹ­ď¸Ź Skipping planning for prompt (${userPrompt.length} chars)`);
      return defaultPlan;
    }

    logChannel?.appendLine('[Rozum] â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
    logChannel?.appendLine('[Rozum] đź§  Zahajuji analĂ˝zu a plĂˇnovĂˇnĂ­...');
    onStatus?.('đź§  Rozum analyzuje dotaz...');

    const planningPrompt = `<think>
Jsi "Rozum" - pokroÄŤilĂ˝ plĂˇnovacĂ­ agent. TvĂ˝m Ăşkolem je vytvoĹ™it EXTRĂ‰MNÄš DETAILNĂŤ a PROMYĹ LENĂť plĂˇn.
UĹľivatel chce, abys postupoval "pomalinku", "zkoumal mnoho souborĹŻ" a vĹˇe "dĹŻkladnÄ› opravil".

DOTAZ:
${userPrompt.slice(0, 1500)}

KONTEXT:
${conversationHistory.slice(-3).map(m => `${m.role}: ${m.content.slice(0, 150)}...`).join('\n')}

TYPY KROKĹ®:
- ANALYZE: Prozkoumat soubory nebo problĂ©m (dĹŻkladnÄ›)
- INSTALL: Instalace balĂ­ÄŤkĹŻ
- CODE: PsanĂ­ kĂłdu (po ÄŤĂˇstech)
- COMPILE: OvÄ›Ĺ™enĂ­ kompilace
- TEST: TestovĂˇnĂ­
- EXPLAIN: VysvÄ›tlenĂ­
- REFACTOR: ÄŚiĹˇtÄ›nĂ­ kĂłdu
- DEBUG: HledĂˇnĂ­ chyb
- DOCUMENT: Dokumentace
- REVIEW: FinĂˇlnĂ­ kontrola

POKYNY K PLĂNOVĂNĂŤ:
1. RozdÄ›l Ăşkol na co nejmenĹˇĂ­, atomickĂ© kroky.
2. Pokud jde o "mnoho souborĹŻ", vytvoĹ™ krok "ANALYZE" pro kaĹľdou skupinu souborĹŻ zvlĂˇĹˇĹĄ.
3. Neboj se vytvoĹ™it 10-20 krokĹŻ. UĹľivatel chce dĹŻkladnost, ne rychlost.
4. KaĹľdĂ˝ krok musĂ­ bĂ˝t ovÄ›Ĺ™itelnĂ˝.

ODPOVÄšZ V TOMTO FORMĂTU:
SLOĹ˝ITOST: [complex]

KROK 1:
TYP: [typ]
NĂZEV: [nĂˇzev]
INSTRUKCE: [detailnĂ­ instrukce]

VAROVĂNĂŤ: [varovĂˇnĂ­]
PĹĂŤSTUP: [pĹ™Ă­stup]
DĂ‰LKA: [long]
</think>`;

    try {
      const fetchFn = this.getFetch();
      const HeadersCtor = this.getHeaders();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const res = await fetchFn(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: new HeadersCtor({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          model: this.model,
          prompt: planningPrompt,
          stream: false,
          options: {
            temperature: 0.2, // Lower temperature for more stable planning
            num_predict: 2048, // More tokens for detailed plans
            top_p: 0.95
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        logChannel?.appendLine(`[Rozum] âťŚ Error ${res.status}`);
        return defaultPlan;
      }

      const data = await res.json() as { response?: string };
      const output = data?.response || '';

      logChannel?.appendLine(`[Rozum] đź“ť Raw odpovÄ›ÄŹ: ${output.slice(0, 300)}...`);

      // Parse the plan
      const plan = this.parsePlan(output);
      
      logChannel?.appendLine(`[Rozum] đź“Š SloĹľitost: ${plan.complexity}`);
      logChannel?.appendLine(`[Rozum] đź“‹ Kroky: ${plan.steps.length}`);
      plan.steps.forEach((step, i) => {
        logChannel?.appendLine(`[Rozum]   ${i + 1}. [${step.type}] ${step.title}`);
      });
      
      onStatus?.(`đź§  Rozum: ${plan.complexity} Ăşloha, ${plan.steps.length} krokĹŻ`);

      return plan;

    } catch (err: unknown) {
      logChannel?.appendLine(`[Rozum] âťŚ Error: ${String(err)}`);
      return defaultPlan;
    }
  }

  /**
   * Review step result - check if it's acceptable
   */
  async reviewStepResult(
    step: ActionStep,
    result: string,
    originalPrompt: string,
    onStatus?: (status: string) => void
  ): Promise<{ approved: boolean; feedback: string; shouldRetry: boolean }> {
    
    logChannel?.appendLine(`[Rozum] đź‘€ Kontroluji vĂ˝sledek kroku ${step.id}...`);
    onStatus?.(`đź‘€ Rozum kontroluje krok ${step.id}...`);

    const reviewPrompt = `<think>
Jsi "Rozum" - kontrolujeĹˇ kvalitu provedenĂ©ho kroku.

PĹ®VODNĂŤ POĹ˝ADAVEK: ${originalPrompt.slice(0, 500)}

KROK KTERĂť SE MÄšL PROVĂ‰ST:
- Typ: ${step.type}
- NĂˇzev: ${step.title}
- Instrukce: ${step.instruction}

VĂťSLEDEK KROKU:
${result.slice(0, 1500)}

ZKONTROLUJ:
1. SplĹuje vĂ˝sledek instrukce kroku?
2. Je vĂ˝sledek ĂşplnĂ˝ a sprĂˇvnĂ˝?
3. Jsou nÄ›jakĂ© chyby nebo vynechanĂ© ÄŤĂˇsti?

ODPOVÄšZ PĹESNÄš:
SCHVĂLENO: [ANO/NE]
DĹ®VOD: [krĂˇtkĂ© vysvÄ›tlenĂ­ max 30 slov]
OPRAVA: [pokud NE, co konkrĂ©tnÄ› opravit - jinak "ĹľĂˇdnĂˇ"]
</think>`;

    try {
      const fetchFn = this.getFetch();
      const HeadersCtor = this.getHeaders();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const res = await fetchFn(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: new HeadersCtor({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          model: this.model,
          prompt: reviewPrompt,
          stream: false,
          options: {
            temperature: 0.2,
            num_predict: 200,
            top_p: 0.9
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        return { approved: true, feedback: 'Review nedostupnĂ˝', shouldRetry: false };
      }

      const data = await res.json() as { response?: string };
      const output = data?.response || '';

      logChannel?.appendLine(`[Rozum Review] Raw: ${output.slice(0, 200)}...`);

      // Parse review response
      const approvedMatch = output.match(/SCHVĂLENO:\s*(ANO|NE|YES|NO)/i);
      const approved = approvedMatch ? 
        (approvedMatch[1].toUpperCase() === 'ANO' || approvedMatch[1].toUpperCase() === 'YES') : 
        true;

      const reasonMatch = output.match(/DĹ®VOD:\s*(.+?)(?=\n|OPRAVA:|$)/i);
      const feedback = reasonMatch ? reasonMatch[1].trim() : 'Bez komentĂˇĹ™e';

      const fixMatch = output.match(/OPRAVA:\s*(.+?)(?=\n|$)/i);
      const fixNeeded = fixMatch ? fixMatch[1].trim() : '';
      const shouldRetry = !approved && fixNeeded.toLowerCase() !== 'ĹľĂˇdnĂˇ' && fixNeeded.length > 5;

      if (approved) {
        logChannel?.appendLine(`[Rozum Review] âś… SchvĂˇleno: ${feedback}`);
        onStatus?.(`âś… Rozum schvĂˇlil krok ${step.id}`);
      } else {
        logChannel?.appendLine(`[Rozum Review] âťŚ ZamĂ­tnuto: ${feedback}`);
        logChannel?.appendLine(`[Rozum Review] đź”§ Oprava: ${fixNeeded}`);
        onStatus?.(`âťŚ Rozum zamĂ­tl krok ${step.id}: ${feedback}`);
      }

      return { approved, feedback, shouldRetry };

    } catch (err: unknown) {
      logChannel?.appendLine(`[Rozum Review] âťŚ Error: ${String(err)}`);
      return { approved: true, feedback: 'Review timeout', shouldRetry: false };
    }
  }

  /**
   * Execute plan step by step with review after each step
   */
  async executeStepByStep(
    plan: RozumPlan,
    originalPrompt: string,
    executeStep: (stepPrompt: string, stepInfo: ActionStep) => Promise<string>,
    onStepStart?: (step: ActionStep, index: number, total: number) => void,
    onStepComplete?: (step: ActionStep, result: string) => void,
    onStepReview?: (step: ActionStep, approved: boolean, feedback: string) => void,
    onSvedomiValidation?: (step: ActionStep, result: string) => Promise<{ approved: boolean; reason?: string } | boolean>,
    onStatus?: (status: string) => void
  ): Promise<string[]> {
    const results: string[] = [];
    this.currentPlanSteps = plan.totalSteps;
    // Massive retry limit for "slow, methodical" checking
    const MAX_STEP_RETRIES = 5;

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      let stepRetries = 0;
      let stepResult = '';
      let stepApproved = false;

      while (!stepApproved && stepRetries <= MAX_STEP_RETRIES) {
        step.status = 'running';
        
        if (stepRetries === 0) {
          onStepStart?.(step, i, plan.steps.length);
          logChannel?.appendLine(`[Rozum] đź”„ SpouĹˇtĂ­m krok ${step.id}/${plan.totalSteps}: ${step.title}`);
        } else {
          logChannel?.appendLine(`[Rozum] đź”„ Opakuji krok ${step.id} (pokus ${stepRetries + 1}/${MAX_STEP_RETRIES + 1})`);
          onStatus?.(`đź”„ Opakuji krok ${step.id} (pokus ${stepRetries + 1})`);
          
          // Explicitly add "slow down" instruction
          step.instruction += "\n\n[DĹ®LEĹ˝ITĂ‰: NespÄ›chej. Zamysli se znovu. Zkontroluj kaĹľdĂ˝ detail.]";
        }

        try {
          const stepPrompt = this.generateStepPrompt(step, originalPrompt, results, plan.totalSteps);
          stepResult = await executeStep(stepPrompt, step);

          // === ROZUM REVIEW ===
          logChannel?.appendLine('');
          logChannel?.appendLine('â”Śâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”');
          logChannel?.appendLine(`â”‚ ROZUM REVIEW - Krok ${step.id}                                        â”‚`);
          logChannel?.appendLine('â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”');

          const review = await this.reviewStepResult(step, stepResult, originalPrompt, onStatus);
          onStepReview?.(step, review.approved, review.feedback);

          if (review.approved) {
            // === SVÄšDOMĂŤ VALIDATION ===
            logChannel?.appendLine('');
            logChannel?.appendLine('â”Śâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”');
            logChannel?.appendLine(`â”‚ SVÄšDOMĂŤ VALIDACE - Krok ${step.id}                                   â”‚`);
            logChannel?.appendLine('â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”');

            const svedomiRaw = onSvedomiValidation 
              ? await onSvedomiValidation(step, stepResult)
              : true;
            
            const svedomiApproved = typeof svedomiRaw === 'object' ? svedomiRaw.approved : svedomiRaw;
            const svedomiReason = (typeof svedomiRaw === 'object' && svedomiRaw.reason) ? svedomiRaw.reason : 'Bez dĹŻvodu';

            if (svedomiApproved) {
              stepApproved = true;
              step.status = 'done';
              step.result = stepResult;
              results.push(stepResult);
              onStepComplete?.(step, stepResult);
              logChannel?.appendLine(`[Pipeline] âś… Krok ${step.id} kompletnÄ› schvĂˇlen (Rozum + Svedomi)`);
            } else {
              logChannel?.appendLine(`[Pipeline] âš ď¸Ź Svedomi zamĂ­tlo krok ${step.id}: ${svedomiReason}`);
              if (stepRetries < MAX_STEP_RETRIES) {
                step.instruction = `${step.instruction}\n\n[OPRAVA OD SVÄšDOMĂŤ - AUTOKOREKCE]: ${svedomiReason}`;
                stepRetries++;
                onStatus?.(`âš ď¸Ź Svedomi zamĂ­tlo: ${svedomiReason.slice(0, 50)}..., opravuji`);
              } else {
                // Accept anyway after max retries
                stepApproved = true;
                step.status = 'done';
                step.result = stepResult + `\n\n*[âš ď¸Ź Tento krok byl pĹ™ijat po maximĂˇlnĂ­m poÄŤtu pokusĹŻ, i pĹ™es nĂˇmitky Svedomi: ${svedomiReason}]*`;
                results.push(step.result);
                onStepComplete?.(step, step.result);
              }
            }
          } else if (review.shouldRetry && stepRetries < MAX_STEP_RETRIES) {
            // Rozum wants retry - modify instruction based on feedback
            step.instruction = `${step.instruction}\n\n[OPRAVA OD ROZUMU]: ${review.feedback}`;
            stepRetries++;
          } else {
            // No retry available or not worth retrying
            stepApproved = true;
            step.status = 'done';
            step.result = stepResult;
            results.push(stepResult);
            onStepComplete?.(step, stepResult);
            logChannel?.appendLine(`[Rozum] âš ď¸Ź Krok ${step.id} pĹ™ijat (max retries nebo malĂˇ chyba)`);
          }

        } catch (err) {
          step.status = 'failed';
          logChannel?.appendLine(`[Rozum] âťŚ Krok ${step.id} selhal: ${String(err)}`);
          
          if (stepRetries < MAX_STEP_RETRIES) {
            stepRetries++;
          } else {
            results.push(`[Krok ${step.id} selhal: ${String(err)}]`);
            stepApproved = true; // Move on
          }
        }
      }
    }

    return results;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getModel(): string {
    return this.model;
  }

  /**
   * Simple greetings and trivial queries that don't need planning
   */
  private simplePatterns: RegExp[] = [
    /^(ahoj|hi|hello|hey|čau|cau|nazdar|dobrý den|dobré ráno|dobrý večer)[!?.,\s]*$/i,
    /^(díky|diky|děkuji|dekuji|thanks|thank you|dík|dik)[!?.,\s]*$/i,
    /^(ano|ne|ok|okay|jo|jasně|jasne|super|fajn)[!?.,\s]*$/i,
    /^(jak se máš|jak se mas|jak se daří|jak se dari|co děláš|co delas)[?!.,\s]*$/i,
    /^(kdo jsi|co jsi|co umíš|co umis)[?!.,\s]*$/i,
    /^[\s\p{P}]*$/u
  ];

  /**
   * Check if prompt is a simple greeting or trivial query
   */
  private isSimpleQuery(prompt: string): boolean {
    const trimmed = prompt.trim();
    if (trimmed.length === 0) return true;
    if (trimmed.length < 15) {
      for (const pattern of this.simplePatterns) {
        if (pattern.test(trimmed)) {
          logChannel?.appendLine(`[Rozum] đź’¬ DetekovĂˇn jednoduchĂ˝ dotaz: "${trimmed}"`);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if prompt should trigger planning
   */
  shouldTriggerPlanning(prompt: string): boolean {
    if (!this.enabled) return false;
    if (this.forcePlan) return true;  // Force plan has priority
    if (this.isSimpleQuery(prompt)) return false;  // Skip planning for greetings
    return prompt.length >= this.minPromptLength;
  }

  /**
   * Create default plan (no planning needed)
   */
  getDefaultPlan(): RozumPlan {
    return {
      shouldPlan: false,
      complexity: 'simple',
      steps: [],
      warnings: [],
      suggestedApproach: 'PĹ™Ă­mĂˇ odpovÄ›ÄŹ',
      estimatedLength: 'short',
      totalSteps: 0
    };
  }
  private normalizePlain(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }


  /**
   * Parse planning response into structured plan
   */
  parsePlan(output: string): RozumPlan {
    const plan: RozumPlan = {
      shouldPlan: true,
      complexity: 'medium',
      steps: [],
      warnings: [],
      suggestedApproach: '',
      estimatedLength: 'medium',
      totalSteps: 0
    };

    const complexityMatch = output.match(/SLO[ŽZ]ITOST:\s*(simple|medium|complex)/i);
    if (complexityMatch) {
      plan.complexity = complexityMatch[1].toLowerCase() as RozumPlan['complexity'];
    }

    const stepMatches = output.matchAll(/KROK\s*(\d+):\s*\n\s*TYP:\s*(\w+)\s*\n\s*N[ÁA]ZEV:\s*(.+?)\s*\n\s*INSTRUKCE:\s*(.+?)(?=\n\s*KROK|\n\s*VAROV[ÁA]N[ÍI]:|\n\s*P[ŘR][ÍI]STUP:|$)/gis);

    for (const match of stepMatches) {
      const stepId = parseInt(match[1], 10);
      const typeRaw = match[2].toLowerCase();
      const title = match[3].trim();
      const instruction = match[4].trim();

      const stepType = this.mapStepType(typeRaw);

      plan.steps.push({
        id: stepId,
        type: stepType,
        title: title.slice(0, 100),
        instruction: instruction.slice(0, 500),
        status: 'pending'
      });
    }

    if (plan.steps.length === 0) {
      const oldStepsSection = output.match(/KROKY?:([\s\S]*?)(?=VAROV[ÁA]N[ÍI]:|P[ŘR][ÍI]STUP:|D[ÉE]LKA:|$)/i);
      if (oldStepsSection) {
        const oldSteps = oldStepsSection[1].match(/-\s*(.+)/g);
        if (oldSteps) {
          oldSteps.forEach((s, i) => {
            const stepText = s.replace(/^-\s*/, '').trim();
            if (stepText.length > 0) {
              plan.steps.push({
                id: i + 1,
                type: this.inferStepType(stepText),
                title: stepText.slice(0, 50),
                instruction: stepText,
                status: 'pending'
              });
            }
          });
        }
      }
    }

    plan.totalSteps = plan.steps.length;

    const warningsMatch = output.match(/VAROV[ÁA]N[ÍI]:\s*(.+?)(?=\n|P[ŘR][ÍI]STUP:|D[ÉE]LKA:|$)/i);
    if (warningsMatch) {
      const warningText = warningsMatch[1].trim();
      const normalized = this.normalizePlain(warningText);
      if (normalized && !['zadne', 'zadna', 'zadny', 'none', 'n/a'].includes(normalized)) {
        plan.warnings = [warningText];
      }
    }

    const approachMatch = output.match(/P[ŘR][ÍI]STUP:\s*(.+?)(?=\n|D[ÉE]LKA:|$)/i);
    if (approachMatch) {
      plan.suggestedApproach = approachMatch[1].trim().slice(0, 200);
    }

    const lengthMatch = output.match(/D[ÉE]LKA:\s*(short|medium|long)/i);
    if (lengthMatch) {
      plan.estimatedLength = lengthMatch[1].toLowerCase() as RozumPlan['estimatedLength'];
    }

    plan.shouldPlan = plan.steps.length > 0;

    return plan;
  }




  /**
   * Map type string to StepType
   */
  private mapStepType(typeRaw: string): StepType {
    const typeMap: Record<string, StepType> = {
      'analyze': 'analyze',
      'install': 'install',
      'code': 'code',
      'compile': 'compile',
      'test': 'test',
      'explain': 'explain',
      'refactor': 'refactor',
      'debug': 'debug',
      'document': 'document',
      'review': 'review'
    };
    return typeMap[typeRaw] || 'other';
  }

  /**
   * Infer step type from text (for fallback parsing)
   */
  inferStepType(text: string): StepType {
    const lower = text.toLowerCase();
    if (/install|npm|pip|yarn|závislost|zavis/i.test(lower)) return 'install';
    if (/kód|kod|napsat|implement|funkc|třída|trida|class/i.test(lower)) return 'code';
    if (/kompil|build|sestavit/i.test(lower)) return 'compile';
    if (/test|ověř|over|zkontrol|funkčnost|funkcnost/i.test(lower)) return 'test';
    if (/vysvět|vysvet|popsat|co je/i.test(lower)) return 'explain';
    if (/refakt|zlepš|zleps|optimaliz/i.test(lower)) return 'refactor';
    if (/debug|chyb|oprav/i.test(lower)) return 'debug';
    if (/dokument|readme|koment/i.test(lower)) return 'document';
    if (/analyz|rozbor|prozkoum/i.test(lower)) return 'analyze';
    if (/review|zkontr|přezkoum|prezkoum/i.test(lower)) return 'review';
    return 'other';
  }



  /**
   * Generate prompt for a specific step
   */
  generateStepPrompt(step: ActionStep, originalPrompt: string, previousResults: string[], totalSteps: number): string {
    const contextFromPrevious = previousResults.length > 0
      ? `\n\nPŘEDCHOZÍ KROKY (${previousResults.length}):\n${previousResults.map((r, i) => `Krok ${i + 1}: ${r.slice(0, 500)}...`).join('\n\n')}`
      : '';

    return `PŮVODNÍ DOTAZ: ${originalPrompt}
${contextFromPrevious}

AKTUÁLNÍ KROK (${step.id}/${totalSteps}): ${step.title}
TYP: ${step.type.toUpperCase()}

INSTRUKCE:
${step.instruction}

PŘÍSTUP K PRÁCI:
- Postupuj METODICKY, KROK PO KROKU
- Pokud analyzuješ soubory, PŘEČTI je CELÉ, ne jen začátek
- Pokud hledáš chyby, ZKONTROLUJ VŠECHNY výskyty, ne jen první
- Dokumentuj CO přesně jsi našel a KDE
- Buď KONKRÉTNÍ - uveď čísla řádků, názvy funkcí, konkrétní chyby

Proveď POUZE tento krok. Buď důkladný a konkrétní.`;
  }



  /**
   * Parse review response
   */
  parseReviewResponse(output: string): { approved: boolean; feedback: string; shouldRetry: boolean } {
    const approvedMatch = output.match(/SCHVÁLENO:\s*(ANO|NE|YES|NO)/i);
    const approved = approvedMatch
      ? (approvedMatch[1].toUpperCase() === 'ANO' || approvedMatch[1].toUpperCase() === 'YES')
      : true;

    const reasonMatch = output.match(/DŮVOD:\s*(.+?)(?=\n|OPRAVA:|$)/i);
    const feedback = reasonMatch ? reasonMatch[1].trim() : 'Bez komentáře';

    const fixMatch = output.match(/OPRAVA:\s*(.+?)(?=\n|$)/i);
    const fixNeeded = fixMatch ? fixMatch[1].trim() : '';
    const normalizedFix = this.normalizePlain(fixNeeded);
    const shouldRetry = !approved
      && normalizedFix !== 'zadne'
      && normalizedFix !== 'zadna'
      && normalizedFix !== 'zadny'
      && normalizedFix !== 'none'
      && normalizedFix !== 'n/a'
      && fixNeeded.length > 5;

    return { approved, feedback, shouldRetry };
  }


  /**
   * Build planning prompt
   */
  buildPlanningPrompt(userPrompt: string, conversationHistory: ChatMessage[]): string {
    return `<think>
Jsi "Rozum" - plánovací agent pro programování. Analyzuj dotaz a vytvoř AKČNÍ PLÁN s konkrétními kroky.

DOTAZ:
${userPrompt.slice(0, 1500)}

KONTEXT:
${conversationHistory.slice(-3).map(m => `${m.role}: ${m.content.slice(0, 150)}...`).join('\n')}

TYPY KROKŮ (použij tyto):
- ANALYZE: Analyzovat požadavek/kód
- INSTALL: Nainstalovat závislosti (npm, pip, atd.)
- CODE: Napsat nebo upravit kód
- COMPILE: Zkompilovat/buildovat projekt
- TEST: Otestovat funkčnost
- EXPLAIN: Vysvětlit koncept/kód
- REFACTOR: Refaktorovat existující kód
- DEBUG: Najít a opravit chybu
- DOCUMENT: Napsat dokumentaci
- REVIEW: Zkontrolovat kód

ODPOVĚZ V TOMTO FORMÁTU:
SLOŽITOST: [simple/medium/complex]

KROK 1:
TYP: [typ z výše]
NÁZEV: [krátký název]
INSTRUKCE: [co přesně má hlavní model udělat]

KROK 2:
TYP: [typ]
NÁZEV: [název]
INSTRUKCE: [instrukce]

(pokračuj s dalšími kroky podle potřeby)

VAROVÁNÍ: [případná varování, nebo "žádné"]
PŘÍSTUP: [doporučený celkový přístup]
DÉLKA: [short/medium/long]
</think>`;
  }



  /**
   * Get step type emoji
   */
  getStepEmoji(type: StepType): string {
    const emojis: Record<StepType, string> = {
      'analyze': 'đź”Ť',
      'install': 'đź“¦',
      'code': 'đź’»',
      'compile': 'đź”¨',
      'test': 'đź§Ş',
      'explain': 'đź“–',
      'refactor': 'â™»ď¸Ź',
      'debug': 'đź›',
      'document': 'đź“ť',
      'review': 'đź‘€',
      'other': 'đź“Ś'
    };
    return emojis[type] || 'đź“Ś';
  }

  /**
   * Determine if prompt needs planning (legacy method name, alias to shouldTriggerPlanning)
   */
  needsPlanning(prompt: string): boolean {
    return this.shouldTriggerPlanning(prompt);
  }
}



