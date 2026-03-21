const mock = require('mock-require');
mock('vscode', {});

const { expect } = require('chai');
const { Rozum } = require('../src/rozum');

describe('Rozum', () => {
  describe('configuration', () => {
    it('should be enabled by default', () => {
      const rozum = new Rozum();
      expect(rozum.isEnabled()).to.be.true;
    });

    it('should store configuration', () => {
      const rozum = new Rozum();
      rozum.configure('http://custom:8080', 'llama3:8b', false, true);
      expect(rozum.isEnabled()).to.be.false;
      expect(rozum.getModel()).to.equal('llama3:8b');
    });
  });

  describe('shouldTriggerPlanning', () => {
    it('should return false when disabled', () => {
      const rozum = new Rozum();
      rozum.configure('http://localhost:11434', 'model', false, false);
      expect(rozum.shouldTriggerPlanning('This is a long enough prompt')).to.be.false;
    });

    it('should return true for long prompts when enabled', () => {
      const rozum = new Rozum();
      expect(rozum.shouldTriggerPlanning('This is a long enough prompt for planning')).to.be.true;
    });

    it('should return false for short prompts', () => {
      const rozum = new Rozum();
      expect(rozum.shouldTriggerPlanning('Hi')).to.be.false;
    });

    it('should return true when forcePlan is enabled regardless of length', () => {
      const rozum = new Rozum();
      rozum.configure('http://localhost:11434', 'model', true, true);
      expect(rozum.shouldTriggerPlanning('Hi')).to.be.true;
    });

    // New tests for simple query detection
    it('should return false for simple greeting "ahoj"', () => {
      const rozum = new Rozum();
      expect(rozum.shouldTriggerPlanning('ahoj')).to.be.false;
    });

    it('should return false for simple greeting with punctuation', () => {
      const rozum = new Rozum();
      expect(rozum.shouldTriggerPlanning('Ahoj!')).to.be.false;
      expect(rozum.shouldTriggerPlanning('hello?')).to.be.false;
      expect(rozum.shouldTriggerPlanning('čau')).to.be.false;
    });

    it('should return false for thanks messages', () => {
      const rozum = new Rozum();
      expect(rozum.shouldTriggerPlanning('díky')).to.be.false;
      expect(rozum.shouldTriggerPlanning('Děkuji!')).to.be.false;
    });

    it('should return false for simple yes/no responses', () => {
      const rozum = new Rozum();
      expect(rozum.shouldTriggerPlanning('ano')).to.be.false;
      expect(rozum.shouldTriggerPlanning('ne')).to.be.false;
      expect(rozum.shouldTriggerPlanning('ok')).to.be.false;
    });

    it('should return true for actual programming questions', () => {
      const rozum = new Rozum();
      // Questions must be >= 30 chars (minPromptLength)
      expect(rozum.shouldTriggerPlanning('Jak napsat funkci v Pythonu která sčítá čísla?')).to.be.true;
      expect(rozum.shouldTriggerPlanning('Vytvoř REST API endpoint pro správu uživatelů')).to.be.true;
    });
  });

  describe('getDefaultPlan', () => {
    it('should return default plan structure', () => {
      const rozum = new Rozum();
      const plan = rozum.getDefaultPlan();
      
      expect(plan.shouldPlan).to.be.false;
      expect(plan.complexity).to.equal('simple');
      expect(plan.steps).to.be.an('array').that.is.empty;
      expect(plan.totalSteps).to.equal(0);
    });
  });

  describe('parsePlan', () => {
    it('should parse complexity', () => {
      const rozum = new Rozum();
      const output = 'SLOŽITOST: complex\nKROKY:\n- něco';
      const plan = rozum.parsePlan(output);
      expect(plan.complexity).to.equal('complex');
    });

    it('should parse new format with typed steps', () => {
      const rozum = new Rozum();
      const output = `SLOŽITOST: medium

KROK 1:
TYP: ANALYZE
NÁZEV: Analyzovat požadavek
INSTRUKCE: Projdi kód a zjisti co je potřeba

KROK 2:
TYP: CODE
NÁZEV: Napsat funkci
INSTRUKCE: Implementuj pomocnou funkci

VAROVÁNÍ: žádné
PŘÍSTUP: Postupné řešení
DÉLKA: medium`;

      const plan = rozum.parsePlan(output);
      
      expect(plan.steps).to.have.length(2);
      expect(plan.steps[0].type).to.equal('analyze');
      expect(plan.steps[0].title).to.equal('Analyzovat požadavek');
      expect(plan.steps[1].type).to.equal('code');
      expect(plan.totalSteps).to.equal(2);
    });

    it('should parse old format (fallback)', () => {
      const rozum = new Rozum();
      const output = `SLOŽITOST: simple
KROKY:
- Nainstalovat npm závislosti
- Write code funkce
- Otestovat výsledek
PŘÍSTUP: Jednoduchý
DÉLKA: short`;

      const plan = rozum.parsePlan(output);
      
      expect(plan.steps).to.have.length(3);
      expect(plan.steps[0].type).to.equal('install');
      expect(plan.steps[1].type).to.equal('code');
      expect(plan.steps[2].type).to.equal('test');
    });

    it('should parse warnings', () => {
      const rozum = new Rozum();
      const output = 'SLOŽITOST: medium\nVAROVÁNÍ: Pozor na edge cases\nPŘÍSTUP: test';
      const plan = rozum.parsePlan(output);
      expect(plan.warnings).to.include('Pozor na edge cases');
    });

    it('should not include "žádné" as warning', () => {
      const rozum = new Rozum();
      const output = 'SLOŽITOST: simple\nVAROVÁNÍ: žádné\nPŘÍSTUP: test';
      const plan = rozum.parsePlan(output);
      expect(plan.warnings).to.be.empty;
    });

    it('should parse approach', () => {
      const rozum = new Rozum();
      const output = 'SLOŽITOST: medium\nPŘÍSTUP: Postupné řešení krok za krokem\nDÉLKA: long';
      const plan = rozum.parsePlan(output);
      expect(plan.suggestedApproach).to.equal('Postupné řešení krok za krokem');
    });

    it('should parse estimated length', () => {
      const rozum = new Rozum();
      const output = 'SLOŽITOST: complex\nDÉLKA: long';
      const plan = rozum.parsePlan(output);
      expect(plan.estimatedLength).to.equal('long');
    });

    it('should set shouldPlan based on steps', () => {
      const rozum = new Rozum();
      
      const withSteps = rozum.parsePlan('SLOŽITOST: medium\nKROKY:\n- něco');
      expect(withSteps.shouldPlan).to.be.true;
      
      const withoutSteps = rozum.parsePlan('SLOŽITOST: simple');
      expect(withoutSteps.shouldPlan).to.be.false;
    });

    it('should truncate plans to maximum 10 steps', () => {
      const rozum = new Rozum();
      // Generate 15 steps in new format
      let output = 'SLOŽITOST: complex\n\n';
      for (let i = 1; i <= 15; i++) {
        output += `KROK ${i}:\nTYP: CODE\nNÁZEV: Step ${i}\nINSTRUKCE: Do thing ${i}\n\n`;
      }
      const plan = rozum.parsePlan(output);
      expect(plan.steps).to.have.length(10);
      expect(plan.totalSteps).to.equal(10);
      expect(plan.steps[9].title).to.equal('Step 10');
    });

    it('should not truncate plans with 10 or fewer steps', () => {
      const rozum = new Rozum();
      let output = 'SLOŽITOST: medium\n\n';
      for (let i = 1; i <= 8; i++) {
        output += `KROK ${i}:\nTYP: CODE\nNÁZEV: Step ${i}\nINSTRUKCE: Do thing ${i}\n\n`;
      }
      const plan = rozum.parsePlan(output);
      expect(plan.steps).to.have.length(8);
      expect(plan.totalSteps).to.equal(8);
    });
  });

  describe('inferStepType', () => {
    it('should infer install type', () => {
      const rozum = new Rozum();
      expect(rozum.inferStepType('npm install dependencies')).to.equal('install');
      expect(rozum.inferStepType('pip install package')).to.equal('install');
      expect(rozum.inferStepType('yarn add something')).to.equal('install');
    });

    it('should infer code type', () => {
      const rozum = new Rozum();
      expect(rozum.inferStepType('Write a function for calculation')).to.equal('code');
      expect(rozum.inferStepType('Implement the class')).to.equal('code');
    });

    it('should infer test type', () => {
      const rozum = new Rozum();
      expect(rozum.inferStepType('test the feature')).to.equal('test');
      expect(rozum.inferStepType('verify the result')).to.equal('test');
    });

    it('should infer debug type', () => {
      const rozum = new Rozum();
      expect(rozum.inferStepType('Debug the error')).to.equal('debug');
      expect(rozum.inferStepType('error')).to.equal('debug');
    });

    it('should return other for unknown', () => {
      const rozum = new Rozum();
      expect(rozum.inferStepType('Something random')).to.equal('other');
    });
  });

  describe('generateStepPrompt', () => {
    it('should generate prompt for step', () => {
      const rozum = new Rozum();
      const step = {
        id: 1,
        type: 'code' as const,
        title: 'Napsat funkci',
        instruction: 'Implementuj funkci pro sčítání',
        status: 'pending' as const
      };
      
      const prompt = rozum.generateStepPrompt(step, 'Vytvoř kalkulačku', [], 3);
      
      expect(prompt).to.include('Vytvoř kalkulačku');
      expect(prompt).to.include('Napsat funkci');
      expect(prompt).to.include('CODE');
      expect(prompt).to.include('1/3');
    });

    it('should include previous results', () => {
      const rozum = new Rozum();
      const step = {
        id: 2,
        type: 'test' as const,
        title: 'Otestovat',
        instruction: 'Otestuj funkci',
        status: 'pending' as const
      };
      
      const prompt = rozum.generateStepPrompt(step, 'Prompt', ['Výsledek kroku 1'], 2);
      
      expect(prompt).to.include('PREVIOUS STEPS');
      expect(prompt).to.include('Step 1');
    });
  });

  describe('parseReviewResponse', () => {
    it('should parse approved response', () => {
      const rozum = new Rozum();
      const output = 'SCHVÁLENO: ANO\nDŮVOD: Vše je v pořádku\nOPRAVA: žádná';
      const result = rozum.parseReviewResponse(output);
      
      expect(result.approved).to.be.true;
      expect(result.feedback).to.equal('Vše je v pořádku');
      expect(result.shouldRetry).to.be.false;
    });

    it('should parse rejected response', () => {
      const rozum = new Rozum();
      const output = 'SCHVÁLENO: NE\nDŮVOD: Chybí error handling\nOPRAVA: Přidej try-catch';
      const result = rozum.parseReviewResponse(output);
      
      expect(result.approved).to.be.false;
      expect(result.feedback).to.equal('Chybí error handling');
      expect(result.shouldRetry).to.be.true;
    });

    it('should handle English format', () => {
      const rozum = new Rozum();
      const output = 'SCHVÁLENO: YES\nDŮVOD: Good';
      const result = rozum.parseReviewResponse(output);
      expect(result.approved).to.be.true;
    });

    it('should default to approved when unclear', () => {
      const rozum = new Rozum();
      const output = 'Something unclear';
      const result = rozum.parseReviewResponse(output);
      expect(result.approved).to.be.true;
    });

    it('should not retry when fix is "žádná"', () => {
      const rozum = new Rozum();
      const output = 'SCHVÁLENO: NE\nDŮVOD: Minor issue\nOPRAVA: žádná';
      const result = rozum.parseReviewResponse(output);
      expect(result.shouldRetry).to.be.false;
    });
  });

  describe('buildPlanningPrompt', () => {
    it('should build planning prompt', () => {
      const rozum = new Rozum();
      const prompt = rozum.buildPlanningPrompt('Vytvoř REST API', [
        { role: 'user', content: 'Ahoj' },
        { role: 'assistant', content: 'Zdravím' }
      ]);
      
      expect(prompt).to.include('Vytvoř REST API');
      expect(prompt).to.include('SLOZITOST');
      expect(prompt).to.include('KROK 1');
      expect(prompt).to.include('TYP');
    });

    it('should truncate long prompts', () => {
      const rozum = new Rozum();
      const longPrompt = 'a'.repeat(3000);
      const result = rozum.buildPlanningPrompt(longPrompt, []);
      
      expect(result.length).to.be.lessThan(longPrompt.length + 1000);
    });

    it('should not coerce excessive step counts', () => {
      const rozum = new Rozum();
      const prompt = rozum.buildPlanningPrompt('Oprav chybu v extension.ts', []);

      expect(prompt).to.include('Use the minimum number of steps needed to finish safely');
      expect(prompt).to.not.include('10-20 krok');
      expect(prompt).to.not.include('pomalinku');
    });
  });

  describe('executePlan - instruction mutation fix', () => {
    it('should not accumulate retry suffixes on step.instruction', async () => {
      const rozum = new Rozum();
      rozum.configure('http://localhost:11434', 'test-model', false, false);

      const plan = {
        shouldPlan: true,
        complexity: 'simple' as const,
        steps: [{
          id: 1,
          type: 'code' as const,
          title: 'Write code',
          instruction: 'Original instruction',
          status: 'pending' as const,
        }],
        warnings: [],
        suggestedApproach: 'test',
        estimatedLength: 'short' as const,
        totalSteps: 1,
      };

      let callCount = 0;
      const capturedInstructions: string[] = [];

      const executeStep = async (prompt: string, step: any) => {
        callCount++;
        capturedInstructions.push(step.instruction);
        return `Result ${callCount}`;
      };

      // Review rejects first 2 attempts, approves 3rd
      let reviewCount = 0;
      const originalReview = rozum.reviewStepResult.bind(rozum);
      rozum.reviewStepResult = async () => {
        reviewCount++;
        if (reviewCount <= 2) {
          return { approved: false, shouldRetry: true, feedback: `Fix issue ${reviewCount}` };
        }
        return { approved: true, shouldRetry: false, feedback: 'OK' };
      };

      await rozum.executeStepByStep(plan, 'test prompt', executeStep);

      // After 3 calls, instruction should still be based on original
      expect(callCount).to.equal(3);
      // First call: original instruction only
      expect(capturedInstructions[0]).to.equal('Original instruction');
      // Second call: original + retry suffix (NOT accumulated)
      expect(capturedInstructions[1]).to.include('Original instruction');
      expect(capturedInstructions[1]).to.include('RETRY ATTEMPT 2');
      expect((capturedInstructions[1].match(/RETRY ATTEMPT/g) || []).length).to.equal(1);
      // Third call: original + retry suffix (NOT accumulated from previous)
      expect(capturedInstructions[2]).to.include('Original instruction');
      expect(capturedInstructions[2]).to.include('RETRY ATTEMPT 3');
      expect((capturedInstructions[2].match(/RETRY ATTEMPT/g) || []).length).to.equal(1);
    }).timeout(10000);

    it('should not accumulate Rozum feedback on step.instruction', async () => {
      const rozum = new Rozum();
      rozum.configure('http://localhost:11434', 'test-model', false, false);

      const plan = {
        shouldPlan: true,
        complexity: 'simple' as const,
        steps: [{
          id: 1,
          type: 'code' as const,
          title: 'Write code',
          instruction: 'Original instruction',
          status: 'pending' as const,
        }],
        warnings: [],
        suggestedApproach: 'test',
        estimatedLength: 'short' as const,
        totalSteps: 1,
      };

      let callCount = 0;
      const capturedInstructions: string[] = [];

      const executeStep = async (prompt: string, step: any) => {
        callCount++;
        capturedInstructions.push(step.instruction);
        return `Result ${callCount}`;
      };

      let reviewCount = 0;
      rozum.reviewStepResult = async () => {
        reviewCount++;
        if (reviewCount <= 2) {
          return { approved: false, shouldRetry: true, feedback: `Rozum feedback ${reviewCount}` };
        }
        return { approved: true, shouldRetry: false, feedback: 'OK' };
      };

      await rozum.executeStepByStep(plan, 'test prompt', executeStep);

      // Third call should have only ONE OPRAVA section, not accumulated
      const lastInstruction = capturedInstructions[capturedInstructions.length - 1];
      expect((lastInstruction.match(/OPRAVA OD ROZUMU/g) || []).length).to.be.at.most(1);
      expect((lastInstruction.match(/RETRY ATTEMPT/g) || []).length).to.be.at.most(1);
    }).timeout(10000);

    it('should stop retrying when Svedomi repeats the same rejection for the same result', async () => {
      const rozum = new Rozum();
      rozum.configure('http://localhost:11434', 'test-model', false, false);

      const plan = {
        shouldPlan: true,
        complexity: 'simple' as const,
        steps: [{
          id: 1,
          type: 'code' as const,
          title: 'Write code',
          instruction: 'Original instruction',
          status: 'pending' as const,
        }],
        warnings: [],
        suggestedApproach: 'test',
        estimatedLength: 'short' as const,
        totalSteps: 1,
      };

      let callCount = 0;
      const executeStep = async () => {
        callCount++;
        return 'Same result';
      };

      rozum.reviewStepResult = async () => ({ approved: true, shouldRetry: false, feedback: 'OK' });

      const results = await rozum.executeStepByStep(
        plan,
        'test prompt',
        executeStep,
        undefined,
        undefined,
        undefined,
        async () => ({ approved: false, reason: 'Odpověď nesplňuje kritéria' })
      );

      expect(callCount).to.equal(2);
      expect(results).to.have.length(1);
      expect(results[0]).to.include('Svedomi opakovaně vracelo stejnou námitku');
    }).timeout(10000);

    it('should detect repeated rejection even with very large result strings', async () => {
      const rozum = new Rozum();
      rozum.configure('http://localhost:11434', 'test-model', false, false);

      const plan = {
        shouldPlan: true,
        complexity: 'simple' as const,
        steps: [{
          id: 1,
          type: 'code' as const,
          title: 'Write code',
          instruction: 'Original instruction',
          status: 'pending' as const,
        }],
        warnings: [],
        suggestedApproach: 'test',
        estimatedLength: 'short' as const,
        totalSteps: 1,
      };

      // Large result (10KB) with identical first 200 chars
      const largePrefix = 'A'.repeat(200);
      let callCount = 0;
      const executeStep = async () => {
        callCount++;
        // Different suffix each time but same first 200 chars
        return largePrefix + 'B'.repeat(10000 + callCount);
      };

      rozum.reviewStepResult = async () => ({ approved: true, shouldRetry: false, feedback: 'OK' });

      const results = await rozum.executeStepByStep(
        plan,
        'test prompt',
        executeStep,
        undefined,
        undefined,
        undefined,
        async () => ({ approved: false, reason: 'Same rejection reason' })
      );

      // Should stop after 2 tries due to truncated signature match
      expect(callCount).to.equal(2);
      expect(results).to.have.length(1);
    }).timeout(10000);

    it('should apply exponential backoff between retries', async () => {
      const rozum = new Rozum();
      rozum.configure('http://localhost:11434', 'test-model', false, false);

      const plan = {
        shouldPlan: true,
        complexity: 'simple' as const,
        steps: [{
          id: 1,
          type: 'code' as const,
          title: 'Write code',
          instruction: 'Original instruction',
          status: 'pending' as const,
        }],
        warnings: [],
        suggestedApproach: 'test',
        estimatedLength: 'short' as const,
        totalSteps: 1,
      };

      const timestamps: number[] = [];
      let callCount = 0;

      const executeStep = async () => {
        callCount++;
        timestamps.push(Date.now());
        return `Result ${callCount}`;
      };

      let reviewCount = 0;
      rozum.reviewStepResult = async () => {
        reviewCount++;
        if (reviewCount <= 2) {
          return { approved: false, shouldRetry: true, feedback: `Issue ${reviewCount}` };
        }
        return { approved: true, shouldRetry: false, feedback: 'OK' };
      };

      await rozum.executeStepByStep(plan, 'test prompt', executeStep);

      expect(callCount).to.equal(3);
      // First retry should have >= 1s backoff (1000ms)
      const gap1 = timestamps[1] - timestamps[0];
      expect(gap1).to.be.at.least(900); // allow 100ms margin
      // Second retry should have >= 2s backoff (2000ms)
      const gap2 = timestamps[2] - timestamps[1];
      expect(gap2).to.be.at.least(1800); // allow 200ms margin
    }).timeout(15000);
  });

  describe('reviewStepResult error handling', () => {
    let savedFetch: any;
    let savedHeaders: any;
    beforeEach(() => {
      savedFetch = (globalThis as any).fetch;
      savedHeaders = (globalThis as any).Headers;
      (globalThis as any).Headers = class { constructor() {} };
    });
    afterEach(() => {
      (globalThis as any).fetch = savedFetch;
      (globalThis as any).Headers = savedHeaders;
    });

    const step = {
      id: 1, type: 'code' as const, title: 'Test', instruction: 'Do it', status: 'pending' as const
    };

    it('should reject step on HTTP 500', async () => {
      const rozum = new Rozum();
      (globalThis as any).fetch = async () => ({ ok: false, status: 500 });
      const res = await rozum.reviewStepResult(step, 'result', 'prompt');
      expect(res.approved).to.be.false;
      expect(res.shouldRetry).to.be.true;
      expect(res.feedback).to.include('500');
    });

    it('should fail-open on network error (step already succeeded)', async () => {
      const rozum = new Rozum();
      (globalThis as any).fetch = async () => { throw new Error('ECONNREFUSED'); };
      const res = await rozum.reviewStepResult(step, 'result', 'prompt');
      expect(res.approved).to.be.true;
      expect(res.shouldRetry).to.be.false;
    });

    it('should fail-open on timeout/abort (step already succeeded)', async () => {
      const rozum = new Rozum();
      (globalThis as any).fetch = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
      const res = await rozum.reviewStepResult(step, 'result', 'prompt');
      expect(res.approved).to.be.true;
      expect(res.shouldRetry).to.be.false;
    });

    it('clearTimeout fires even when fetch throws in plan()', async () => {
      const rozum = new Rozum();
      rozum.configure('http://localhost:11434', 'test-model', true, true);
      let timerCleared = false;
      const origSetTimeout = globalThis.setTimeout;
      const origClearTimeout = globalThis.clearTimeout;
      (globalThis as any).fetch = async () => { throw new Error('boom'); };
      // Patch clearTimeout to detect if it's called
      const timers: any[] = [];
      (globalThis as any).setTimeout = (...args: any[]) => {
        const id = origSetTimeout(...args as Parameters<typeof origSetTimeout>);
        timers.push(id);
        return id;
      };
      (globalThis as any).clearTimeout = (id: any) => {
        if (timers.includes(id)) { timerCleared = true; }
        return origClearTimeout(id);
      };
      try {
        await rozum.plan('A long enough prompt for planning to trigger', []);
        expect(timerCleared).to.be.true;
      } finally {
        globalThis.setTimeout = origSetTimeout;
        globalThis.clearTimeout = origClearTimeout;
      }
    });

    it('should return default plan when res.json() hangs indefinitely', async () => {
      const rozum = new Rozum();
      rozum.configure('http://localhost:11434', 'test-model', true, true);
      // Mock fetch returning ok:true but json() that never resolves
      (globalThis as any).fetch = async () => ({
        ok: true,
        status: 200,
        json: () => new Promise(() => {}) // never resolves
      });
      const plan = await rozum.plan('A long enough prompt for planning to trigger', []);
      // Should fall back to default plan (catch block) because jsonWithTimeout rejects
      expect(plan.shouldPlan).to.be.false;
      expect(plan.steps).to.have.length(0);
    }).timeout(40000); // jsonWithTimeout is 30s

    it('should fail-open review when res.json() hangs', async () => {
      const rozum = new Rozum();
      (globalThis as any).fetch = async () => ({
        ok: true,
        status: 200,
        json: () => new Promise(() => {}) // never resolves
      });
      const step = {
        id: 1, type: 'code' as const, title: 'Test', instruction: 'Do it', status: 'pending' as const
      };
      const res = await rozum.reviewStepResult(step, 'result', 'prompt');
      // reviewStepResult fails open on errors
      expect(res.approved).to.be.true;
      expect(res.shouldRetry).to.be.false;
    }).timeout(40000);
  });

  describe('instruction length cap', () => {
    it('generateStepPrompt caps step.instruction at 50000 chars', () => {
      const rozum = new Rozum();
      const longInstruction = 'Z'.repeat(80000);
      const step = {
        id: 1,
        type: 'code' as const,
        title: 'Big step',
        instruction: longInstruction,
        status: 'pending' as const
      };

      const prompt = rozum.generateStepPrompt(step, 'Short prompt', [], 1);
      // The full 80000 chars should NOT appear in prompt
      expect(prompt.length).to.be.lessThan(longInstruction.length);
      expect(prompt).to.not.include(longInstruction);
    });
  });

  // ── retry feedback truncation (replicated logic, R50) ──────
  describe('retry feedback truncation', () => {
    it('should cap svedomi reason to 500 chars in instruction', () => {
      const originalInstruction = 'Original';
      const svedomiReason = 'x'.repeat(2000);
      const instruction = `${originalInstruction}\n\n[OPRAVA OD SVĚDOMI - AUTOKOREKCE]: ${svedomiReason.slice(0, 500)}`;
      expect(instruction).to.include('Original');
      expect(instruction.length).to.be.lessThan(originalInstruction.length + 600);
    });

    it('should cap rozum feedback to 500 chars in instruction', () => {
      const originalInstruction = 'Original';
      const feedback = 'y'.repeat(3000);
      const instruction = `${originalInstruction}\n\n[OPRAVA OD ROZUMU]: ${feedback.slice(0, 500)}`;
      expect(instruction).to.include('Original');
      expect(instruction.length).to.be.lessThan(originalInstruction.length + 600);
    });
  });
});
