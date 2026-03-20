// Rozum module - Planning and reasoning agent
// Exported for testing and modular use

import type { ChatMessage } from './types';
import fetch, { Headers } from 'node-fetch';

const JSON_PARSE_TIMEOUT = 30_000; // 30s for body parsing after HTTP 200

/** Race res.json() against a timeout to prevent hanging on incomplete bodies */
function jsonWithTimeout<T>(res: { json: () => Promise<T> }, ms: number = JSON_PARSE_TIMEOUT): Promise<T> {
  return Promise.race([
    res.json(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('res.json() timeout')), ms)
    )
  ]);
}

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

    const planningPrompt = this.buildPlanningPrompt(userPrompt, conversationHistory);

    try {
      const fetchFn = this.getFetch();
      const HeadersCtor = this.getHeaders();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      let res;
      try {
        res = await fetchFn(`${this.baseUrl}/api/generate`, {
          method: 'POST',
          headers: new HeadersCtor({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            model: this.model,
            prompt: planningPrompt,
            stream: false,
            options: {
              temperature: 0.3, // Slight creativity for better decomposition
              num_predict: 4096, // Enough tokens for 15+ detailed steps
              top_p: 0.95,
              repeat_penalty: 1.1 // Discourage repetitive step descriptions
            }
          }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!res.ok) {
        logChannel?.appendLine(`[Rozum] âťŚ Error ${res.status}`);
        return defaultPlan;
      }

      const data = await jsonWithTimeout<{ response?: string }>(res);
      const output = data?.response || '';

      logChannel?.appendLine(`[Rozum] \u{1F4DD} Raw odpov\u011B\u010F: ${output.slice(0, 300)}...`);

      // Parse the plan
      const plan = this.parsePlan(output);
      
      logChannel?.appendLine(`[Rozum] \u{1F4CA} Slo\u017Eitost: ${plan.complexity}`);
      logChannel?.appendLine(`[Rozum] \u{1F4CB} Kroky: ${plan.steps.length}`);
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
${result.slice(0, 4000)}

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

      let res;
      try {
        res = await fetchFn(`${this.baseUrl}/api/generate`, {
          method: 'POST',
          headers: new HeadersCtor({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            model: this.model,
            prompt: reviewPrompt,
            stream: false,
            options: {
              temperature: 0.15,
              num_predict: 400,
              top_p: 0.9
            }
          }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!res.ok) {
        return { approved: false, feedback: 'Review nedostupný (HTTP ' + res.status + ')', shouldRetry: true };
      }

      const data = await jsonWithTimeout<{ response?: string }>(res);
      const output = data?.response || '';

      logChannel?.appendLine(`[Rozum Review] Raw: ${output.slice(0, 200)}...`);

      // Parse review response
      const approvedMatch = output.match(/(?:SCHV\u00C1LENO|APPROVED):\s*(ANO|NE|YES|NO)/i);
      const approved = approvedMatch ? 
        (approvedMatch[1].toUpperCase() === 'ANO' || approvedMatch[1].toUpperCase() === 'YES') : 
        true;

      const reasonMatch = output.match(/(?:DĹ®VOD|DŮVOD|REASON):\s*(.+?)(?=\n|OPRAVA:|FIX:|$)/i);
      const feedback = reasonMatch ? reasonMatch[1].trim() : 'Bez komentĂˇĹ™e';

      const fixMatch = output.match(/(?:OPRAVA|FIX):\s*(.+?)(?=\n|$)/i);
      const fixNeeded = fixMatch ? fixMatch[1].trim() : '';
      const shouldRetry = !approved && fixNeeded.toLowerCase() !== 'ĹľĂˇdnĂˇ' && fixNeeded.toLowerCase() !== 'none' && fixNeeded.length > 5;

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
      // Fail-open on review network errors: the step itself succeeded, only review is down
      return { approved: true, feedback: 'Review nedostupný – krok přijat', shouldRetry: false };
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
    // Massive retry limit for "slow, methodical" checking
    const MAX_STEP_RETRIES = 5;

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const originalInstruction = step.instruction;
      let stepRetries = 0;
      let stepResult = '';
      let stepApproved = false;
      let lastRejectionSignature: string | null = null;
      let repeatedRejectionCount = 0;

      const isRepeatedRejection = (source: 'rozum' | 'svedomi', reason: string, result: string): boolean => {
        const signature = `${source}::${reason.trim().slice(0, 200)}::${result.trim().slice(0, 200)}`;
        if (signature === lastRejectionSignature) {
          repeatedRejectionCount++;
        } else {
          lastRejectionSignature = signature;
          repeatedRejectionCount = 1;
        }
        return repeatedRejectionCount >= 2;
      };

      const acceptStepWithNote = (note: string): void => {
        stepApproved = true;
        step.status = 'done';
        step.result = `${stepResult}\n\n*[⚠️ ${note}]*`;
        results.push(step.result);
        onStepComplete?.(step, step.result);
      };

      while (!stepApproved && stepRetries <= MAX_STEP_RETRIES) {
        step.status = 'running';
        
        if (stepRetries === 0) {
          onStepStart?.(step, i, plan.steps.length);
          logChannel?.appendLine(`[Rozum] đź”„ SpouĹˇtĂ­m krok ${step.id}/${plan.totalSteps}: ${step.title}`);
        } else {
          // Exponential backoff: 1s, 2s, 4s, 8s, 16s
          const backoffMs = Math.min(1000 * Math.pow(2, stepRetries - 1), 16000);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          logChannel?.appendLine(`[Rozum] đź"„ Opakuji krok ${step.id} (pokus ${stepRetries + 1}/${MAX_STEP_RETRIES + 1}, backoff ${backoffMs}ms)`);
          onStatus?.(`đź”„ Opakuji krok ${step.id} (pokus ${stepRetries + 1})`);
          
          // Rebuild instruction from original + retry suffix (prevent accumulation)
          step.instruction = `${originalInstruction}\n\n[RETRY ATTEMPT ${stepRetries + 1}: The previous attempt was rejected. Review the feedback carefully and address the specific issues. Do NOT repeat the same mistake.]`;
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
              if (isRepeatedRejection('svedomi', svedomiReason, stepResult)) {
                acceptStepWithNote(`Tento krok byl přijat, protože Svedomi opakovaně vracelo stejnou námitku bez nové informace: ${svedomiReason}`);
                logChannel?.appendLine(`[Pipeline] âš ď¸Ź UkonÄŤuji opakovĂˇnĂ­ kroku ${step.id}: opakovanĂˇ stejnĂˇ nĂˇmitka od Svedomi`);
              } else if (stepRetries < MAX_STEP_RETRIES) {
                step.instruction = `${originalInstruction}\n\n[OPRAVA OD SVÄšDOMĂŤ - AUTOKOREKCE]: ${svedomiReason}`;
                stepRetries++;
                onStatus?.(`âš ď¸Ź Svedomi zamĂ­tlo: ${svedomiReason.slice(0, 50)}..., opravuji`);
              } else {
                // Accept anyway after max retries
                acceptStepWithNote(`Tento krok byl přijat po maximálním počtu pokusů, i přes námitky Svedomi: ${svedomiReason}`);
              }
            }
          } else if (review.shouldRetry && stepRetries < MAX_STEP_RETRIES) {
            // Rozum wants retry - modify instruction based on feedback
            if (isRepeatedRejection('rozum', review.feedback, stepResult)) {
              acceptStepWithNote(`Tento krok byl přijat, protože Rozum opakovaně vracel stejnou námitku bez nové informace: ${review.feedback}`);
              logChannel?.appendLine(`[Rozum] âš ď¸Ź UkonÄŤuji opakovĂˇnĂ­ kroku ${step.id}: opakovanĂˇ stejnĂˇ nĂˇmitka od Rozumu`);
            } else {
              step.instruction = `${originalInstruction}\n\n[OPRAVA OD ROZUMU]: ${review.feedback}`;
              stepRetries++;
            }
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

    const stepMatches = output.matchAll(/KROK\s*(\d+):\s*\n\s*TYP:\s*(\w+)\s*\n\s*N[ÁA]ZEV:\s*(.+?)\s*\n\s*INSTRUKCE:\s*(.+?)(?=\nKROK\s*\d|\nVAROV[ÁA]N[ÍI]:|\nPRISTUP:|\nP[ŘR][ÍI]STUP:|\nDELKA:|\nD[ÉE]LKA:|$)/gis);

    for (const match of stepMatches) {
      const stepId = parseInt(match[1], 10);
      const typeRaw = match[2].toLowerCase();
      const title = match[3].trim();
      const instruction = match[4].trim();

      const stepType = this.mapStepType(typeRaw);

      plan.steps.push({
        id: stepId,
        type: stepType,
        title: title.slice(0, 120),
        instruction: instruction.slice(0, 2000),
        status: 'pending'
      });
    }

    if (plan.steps.length === 0) {
      logChannel?.appendLine('[Rozum] ⚠️ New format parse found 0 steps, trying old format fallback');
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

    // Cap plan to MAX_PLAN_STEPS to prevent unbounded execution
    const MAX_PLAN_STEPS = 10;
    if (plan.steps.length > MAX_PLAN_STEPS) {
      logChannel?.appendLine(`[Rozum] ⚠️ Plan truncated from ${plan.steps.length} to ${MAX_PLAN_STEPS} steps`);
      plan.steps = plan.steps.slice(0, MAX_PLAN_STEPS);
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
    if (/install|npm|pip|yarn|depend/i.test(lower)) return 'install';
    if (/code|write|implement|function|class/i.test(lower)) return 'code';
    if (/compile|build/i.test(lower)) return 'compile';
    if (/test|verify|check/i.test(lower)) return 'test';
    if (/explain|describe/i.test(lower)) return 'explain';
    if (/refactor|improve|optimiz/i.test(lower)) return 'refactor';
    if (/debug|error|fix|bug/i.test(lower)) return 'debug';
    if (/document|readme|comment/i.test(lower)) return 'document';
    if (/analyze|examine|explore/i.test(lower)) return 'analyze';
    if (/review/i.test(lower)) return 'review';
    return 'other';
  }



  /**
   * Generate prompt for a specific step
   */
  generateStepPrompt(step: ActionStep, originalPrompt: string, previousResults: string[], totalSteps: number): string {
    // Give more context from recent steps, less from older ones
    let contextFromPrevious = '';
    if (previousResults.length > 0) {
      const recentCount = Math.min(3, previousResults.length);
      const olderCount = previousResults.length - recentCount;
      const olderSummary = olderCount > 0
        ? previousResults.slice(0, olderCount).map((r, i) => `Step ${i + 1}: ${r.slice(0, 200)}...`).join('\n')
        : '';
      const recentDetail = previousResults.slice(olderCount).map((r, i) => `Step ${olderCount + i + 1}: ${r.slice(0, 1500)}`).join('\n---\n');
      contextFromPrevious = `\n\n=== PREVIOUS STEPS (${previousResults.length} completed) ===\n${olderSummary ? 'Older steps (summary):\n' + olderSummary + '\n\nRecent steps (detailed):\n' : ''}${recentDetail}`;
    }

    const typeGuidance: Record<string, string> = {
      'analyze': 'Read files COMPLETELY. List every relevant function, class, and dependency. Note line numbers.',
      'code': 'Write clean, minimal code. Follow existing patterns. Show exact file paths and line numbers for edits.',
      'compile': 'Run the build command. If errors occur, list ALL of them with file:line references.',
      'test': 'Run tests. Report pass/fail counts. If failures occur, show the assertion messages.',
      'refactor': 'Preserve behavior. Show before/after for each change. Verify no regressions.',
      'debug': 'Reproduce the bug first. Identify root cause (not symptoms). Verify the fix.',
      'install': 'Use exact version pins when possible. Verify installation succeeded.',
      'review': 'Check that ALL original requirements are met. List any remaining issues.',
      'document': 'Be accurate. Reference actual code, not assumptions.',
      'explain': 'Be precise and reference concrete code/architecture.'
    };
    const guidance = typeGuidance[step.type] || 'Be thorough and specific.';

    return `=== ORIGINAL REQUEST ===
${originalPrompt.slice(0, 3000)}
${contextFromPrevious}

=== CURRENT STEP (${step.id}/${totalSteps}): ${step.title} ===
Type: ${step.type.toUpperCase()}

Instruction:
${step.instruction}

=== EXECUTION GUIDELINES ===
- ${guidance}
- Be SPECIFIC: file paths, line numbers, function names, exact error messages.
- Do ONLY this step. Do not jump ahead to future steps.
- If you encounter a blocker, describe it clearly instead of guessing.
- Show your work — explain what you found and why you made each decision.`;
  }



  /**
   * Parse review response
   */
  parseReviewResponse(output: string): { approved: boolean; feedback: string; shouldRetry: boolean } {
    const approvedMatch = output.match(/(?:SCHVALENO|SCHVĂLENO|SCHVÁLENO|APPROVED):\s*(ANO|NE|YES|NO)/i);
    const approved = approvedMatch
      ? (approvedMatch[1].toUpperCase() === 'ANO' || approvedMatch[1].toUpperCase() === 'YES')
      : true;

    const reasonMatch = output.match(/(?:DŮVOD|DĹ®VOD|REASON):\s*(.+?)(?=\n|OPRAVA:|FIX:|$)/i);
    const feedback = reasonMatch ? reasonMatch[1].trim() : 'Bez komentáře';

    const fixMatch = output.match(/(?:OPRAVA|FIX):\s*(.+?)(?=\n|$)/i);
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
You are "Rozum" — a planning agent for software engineering. Analyze the request and create a precise, actionable plan.

TASK:
${userPrompt.slice(0, 2500)}

CONTEXT:
${conversationHistory.slice(-5).map(m => `[${m.role}]: ${m.content.slice(0, 1500)}`).join('\n---\n')}

STEP TYPES:
- ANALYZE: Examine code, files, or the problem
- INSTALL: Install dependencies
- CODE: Write or modify code
- COMPILE: Build / compile the project
- TEST: Test functionality
- EXPLAIN: Explain a concept or architecture
- REFACTOR: Restructure code without changing behavior
- DEBUG: Find and fix bugs
- DOCUMENT: Write documentation
- REVIEW: Final verification

RULES:
1. Start with ANALYZE. Never jump to CODE without understanding first.
2. After CODE, always verify with COMPILE or TEST.
3. End with REVIEW.
4. Each step: WHAT to do, WHERE (files), HOW to verify.
5. Use the minimum number of steps needed to finish safely. Usually 3-7 steps.
6. Only create 8+ steps when the request explicitly requires broad multi-file work, migrations, or staged validation.
7. Do not invent unrelated domains, files, or technologies. Stay grounded in the actual task and context.

FORMAT:
SLOZITOST: [simple|medium|complex]

KROK 1:
TYP: [type]
NAZEV: [title]
INSTRUKCE: [detailed instruction]

VAROVANI: [warnings or "none"]
PRISTUP: [approach summary]
DELKA: [short|medium|long]
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



