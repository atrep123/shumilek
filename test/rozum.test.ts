const mock = require('mock-require');
mock('vscode', {});

(globalThis as any).expect = require('chai').expect;
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
- Napsat kód funkce
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
      expect(rozum.inferStepType('Napsat funkci pro výpočet')).to.equal('code');
      expect(rozum.inferStepType('Implement the class')).to.equal('code');
    });

    it('should infer test type', () => {
      const rozum = new Rozum();
      expect(rozum.inferStepType('Otestovat funkčnost')).to.equal('test');
      expect(rozum.inferStepType('Ověřit výsledek')).to.equal('test');
    });

    it('should infer debug type', () => {
      const rozum = new Rozum();
      expect(rozum.inferStepType('Debug the error')).to.equal('debug');
      expect(rozum.inferStepType('Opravit chybu')).to.equal('debug');
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
      
      expect(prompt).to.include('PŘEDCHOZÍ KROKY');
      expect(prompt).to.include('Krok 1');
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
      expect(prompt).to.include('SLOŽITOST');
      expect(prompt).to.include('KROK 1');
      expect(prompt).to.include('TYP');
    });

    it('should truncate long prompts', () => {
      const rozum = new Rozum();
      const longPrompt = 'a'.repeat(3000);
      const result = rozum.buildPlanningPrompt(longPrompt, []);
      
      expect(result.length).to.be.lessThan(longPrompt.length + 1000);
    });
  });
});

