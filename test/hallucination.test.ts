import { expect } from 'chai';
import { HallucinationDetector, setHallucinationLogger } from '../src/hallucination';
import { ChatMessage, HallucinationResult } from '../src/types';

describe('HallucinationDetector', () => {
  let detector: HallucinationDetector;

  beforeEach(() => {
    detector = new HallucinationDetector();
  });

  // --- setHallucinationLogger ---
  describe('setHallucinationLogger', () => {
    it('accepts a logger function without error', () => {
      const msgs: string[] = [];
      setHallucinationLogger(m => msgs.push(m));
      // Just verifying it doesn't throw
    });
  });

  // --- analyze: clean responses ---
  describe('clean responses', () => {
    it('clean code-only response returns no hallucination', () => {
      const result = detector.analyze(
        '```ts\nconst x = 1;\n```\nHotovo.',
        'Napiš funkci',
        []
      );
      expect(result.isHallucination).to.be.false;
      expect(result.confidence).to.be.below(0.3);
      expect(result.category).to.equal('none');
    });

    it('empty response returns no hallucination', () => {
      const result = detector.analyze('', 'Ahoj', []);
      expect(result.isHallucination).to.be.false;
      expect(result.confidence).to.equal(0);
    });
  });

  // --- analyze: self-reference patterns ---
  describe('self-reference patterns', () => {
    it('detects "jako AI" pattern', () => {
      const result = detector.analyze(
        'Jako AI nemám přímý přístup k souborům.',
        'Uprav soubor',
        []
      );
      expect(result.confidence).to.be.greaterThan(0);
      expect(result.reasons.length).to.be.greaterThan(0);
      expect(result.category).to.equal('self-reference');
    });

    it('detects "nemám přístup" pattern', () => {
      const result = detector.analyze(
        'Nemám přístup ke tvým souborům, ale mohu pomoci.',
        'Uprav kód',
        []
      );
      expect(result.confidence).to.be.greaterThan(0);
    });

    it('self-reference only is capped at 0.4', () => {
      const result = detector.analyze(
        'Jako AI nemám přístup. Nemohu vidět tvůj kód. Nemám schopnost.',
        'Co vidíš?',
        []
      );
      expect(result.confidence).to.be.at.most(0.4);
      expect(result.isHallucination).to.be.false;
    });
  });

  // --- analyze: factual patterns ---
  describe('factual patterns', () => {
    it('detects "podle mých informací z roku" pattern', () => {
      const result = detector.analyze(
        'Podle mých informací z roku 2023, TypeScript 5 je stabilní.',
        'Jaká verze?',
        []
      );
      expect(result.confidence).to.be.greaterThan(0);
      expect(result.category).to.equal('factual');
    });

    it('detects "je všeobecně známo" pattern', () => {
      const result = detector.analyze(
        'Je všeobecně známo, že JavaScript je nejlepší jazyk.',
        'Řekni mi něco',
        []
      );
      expect(result.confidence).to.be.greaterThan(0);
    });

    it('detects "není pochyb" pattern', () => {
      const result = detector.analyze(
        'Není pochyb o tom, že toto je správný přístup. Fakta jsou, že toto funguje.',
        'Je to dobrý kód?',
        []
      );
      expect(result.confidence).to.be.greaterThan(0);
    });
  });

  // --- analyze: contextual patterns ---
  describe('contextual patterns', () => {
    it('detects back-reference with empty history → high weight', () => {
      const result = detector.analyze(
        'Jak jsem již zmínil v předchozí odpovědi, tento kód je špatně.',
        'Co s kódem?',
        []  // empty history → suspicious
      );
      expect(result.confidence).to.be.greaterThan(0.5);
      expect(result.isHallucination).to.be.true;
      expect(result.category).to.equal('contextual');
    });

    it('contextual ref with long history does not get extra weight', () => {
      const history: ChatMessage[] = [
        { role: 'user', content: 'Ahoj' },
        { role: 'assistant', content: 'Čau!' },
        { role: 'user', content: 'Pomoz mi' },
      ];
      const result = detector.analyze(
        'Jak jsem zmínil, tento přístup je lepší.',
        'Pokračuj',
        history
      );
      // With >= 2 messages, extra 0.6 is NOT added
      expect(result.confidence).to.be.at.most(0.6);
    });

    it('contextual ref with followup intent gets reduced weight', () => {
      const result = detector.analyze(
        'Jak jsem již zmínil v tomto kódu...',
        'pokračuj v práci',
        []
      );
      // The followup keyword "pokračuj" should reduce contextual weight
      expect(result.reasons.some(r => r.includes('vyžádána promptem'))).to.be.true;
    });
  });

  // --- analyze: suspicious URLs ---
  describe('suspicious URLs', () => {
    it('flags URL with very long path', () => {
      const longPath = 'https://example.com/' + 'a'.repeat(80);
      const result = detector.analyze(
        `Podívej se na ${longPath} pro více info.`,
        'Jak na to?',
        []
      );
      expect(result.reasons.some(r => r.includes('URL'))).to.be.true;
    });

    it('does not flag URL that appears in user prompt', () => {
      const url = 'https://example.com/' + 'a'.repeat(80);
      const result = detector.analyze(
        `Podívej se na ${url}.`,
        `Použij ${url} jako zdroj`,
        []
      );
      expect(result.reasons.filter(r => r.includes('URL'))).to.have.length(0);
    });

    it('flags URL with many path segments', () => {
      const url = 'https://example.com/a/b/c/d/e/f';
      const result = detector.analyze(
        `Najdi na ${url} dokumentaci.`,
        'Kde najdu dokumentaci?',
        []
      );
      expect(result.reasons.some(r => r.includes('URL'))).to.be.true;
    });

    it('does not flag URL whose host is in prompt', () => {
      const result = detector.analyze(
        'Na https://docs.github.com/a/b/c/d/e najdeš odpověď.',
        'Najdi na docs.github.com dokumentaci',
        []
      );
      expect(result.reasons.filter(r => r.includes('URL'))).to.have.length(0);
    });
  });

  // --- analyze: uncertainty hedge ---
  describe('uncertainty hedge', () => {
    it('reduces factual confidence when hedging language present', () => {
      const withoutHedge = detector.analyze(
        'Podle mých informací z roku 2023, je to jasné. Fakta jsou, že to funguje.',
        'Jak?',
        []
      );
      const withHedge = detector.analyze(
        'Možná podle mých informací z roku 2023, je to jasné. Fakta jsou, že to funguje.',
        'Jak?',
        []
      );
      expect(withHedge.confidence).to.be.below(withoutHedge.confidence);
      expect(withHedge.reasons.some(r => r.includes('snížena'))).to.be.true;
    });
  });

  // --- analyze: safe patterns (code blocks) ---
  describe('safe pattern stripping', () => {
    it('patterns inside code blocks are ignored', () => {
      const result = detector.analyze(
        '```\nJako AI nemám přístup. Podle mých informací z roku 2023. Není pochyb.\n```',
        'Ukaž kód',
        []
      );
      expect(result.confidence).to.equal(0);
      expect(result.isHallucination).to.be.false;
    });
  });

  // --- getSummary ---
  describe('getSummary', () => {
    it('returns ✅ for clean result', () => {
      const result: HallucinationResult = {
        isHallucination: false,
        confidence: 0.1,
        reasons: [],
        category: 'none'
      };
      expect(detector.getSummary(result)).to.include('✅');
    });

    it('returns ⚠️ for borderline result', () => {
      const result: HallucinationResult = {
        isHallucination: false,
        confidence: 0.35,
        reasons: ['test'],
        category: 'factual'
      };
      expect(detector.getSummary(result)).to.include('⚠️');
    });

    it('returns 🚨 for hallucination result', () => {
      const result: HallucinationResult = {
        isHallucination: true,
        confidence: 0.8,
        reasons: ['test'],
        category: 'contextual'
      };
      const summary = detector.getSummary(result);
      expect(summary).to.include('🚨');
      expect(summary).to.include('contextual');
    });
  });

  // --- logging ---
  describe('logging', () => {
    it('logs when confidence > 0.3', () => {
      const msgs: string[] = [];
      setHallucinationLogger(m => msgs.push(m));
      detector.analyze(
        'Jak jsem již zmínil v předchozí odpovědi, kód je špatně.',
        'Co s kódem?',
        []
      );
      expect(msgs.length).to.be.greaterThan(0);
      expect(msgs.some(m => m.includes('HallucinationDetector'))).to.be.true;
      // Clean up
      setHallucinationLogger(() => {});
    });
  });
});
