const mock = require('mock-require');
mock('vscode', {});

const { expect } = require('chai');
const { ResponseGuardian } = require('../src/guardian');
const { HallucinationDetector } = require('../src/hallucination');

describe('ResponseGuardian', () => {
  it('should detect empty response', () => {
    const g = new ResponseGuardian();
    const res = g.analyze('', 'Hello');
    expect(res.isOk).to.be.false;
    expect(res.shouldRetry).to.be.true;
    expect(res.issues).to.include('Prázdná nebo příliš krátká odpověď');
  });

  it('should detect too short response', () => {
    const g = new ResponseGuardian();
    const res = g.analyze('Hi', 'Hello');
    expect(res.isOk).to.be.false;
    expect(res.shouldRetry).to.be.true;
  });

  it('should accept valid response', () => {
    const g = new ResponseGuardian();
    const res = g.analyze('Toto je validní odpověď na dotaz uživatele.', 'Co je nového?');
    expect(res.isOk).to.be.true;
    expect(res.shouldRetry).to.be.false;
  });

  it('should detect repetition score correctly', () => {
    const long = 'test '.repeat(50);
    const g = new ResponseGuardian();
    const res = g.analyze(long, 'prompt');
    expect(res.repetitionScore).to.be.at.least(0);
    expect(res.repetitionScore).to.be.greaterThan(0);
  });

  it('should detect loop patterns', () => {
    const g = new ResponseGuardian();
    const loopText = 'toto je smyčka '.repeat(20);
    const res = g.analyze(loopText, 'prompt');
    expect(res.loopDetected).to.be.true;
    expect(res.issues.some((i: string) => i.includes('smyčka'))).to.be.true;
  });

  it('should detect character repetition', () => {
    const g = new ResponseGuardian();
    const repeatedChars = 'a'.repeat(30);
    const res = g.analyze('Text with ' + repeatedChars + ' in it', 'prompt');
    expect(res.loopDetected).to.be.true;
  });

  it('should detect glued text without spaces', () => {
    const g = new ResponseGuardian();
    const gluedText = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz';
    const res = g.analyze('Normal text. ' + gluedText, 'prompt');
    expect(res.issues.some((i: string) => i.toLowerCase().includes('slitý'))).to.be.true;
  });

  it('should detect unclosed code blocks', () => {
    const g = new ResponseGuardian();
    const unclosed = 'Here is code:\n```javascript\nconst x = 1;';
    const res = g.analyze(unclosed, 'prompt');
    expect(res.issues.some((i: string) => i.includes('Neuzavřený blok kódu'))).to.be.true;
  });

  it('should detect empty markdown links', () => {
    const g = new ResponseGuardian();
    const emptyLinks = 'Check this [link]() and [another]()';
    const res = g.analyze(emptyLinks, 'prompt');
    expect(res.issues.some((i: string) => i.includes('Prázdné markdown odkazy'))).to.be.true;
  });

  it('should detect TODO/FIXME markers', () => {
    const g = new ResponseGuardian();
    const withTodo = 'Code here TODO: fix this later';
    const res = g.analyze(withTodo, 'prompt');
    expect(res.issues.some((i: string) => i.includes('TODO/FIXME'))).to.be.true;
  });

  it('should not flag single null/NaN mention in explanation', () => {
    const g = new ResponseGuardian();
    const text = 'V JavaScriptu null reprezentuje prazdnou hodnotu a NaN znamena neplatne cislo.';
    const res = g.analyze(text, 'Vysvetli null a NaN');
    expect(res.issues.some((i: string) => i.includes('null hodnot'))).to.be.false;
    expect(res.issues.some((i: string) => i.includes('NaN hodnot'))).to.be.false;
  });

  it('should flag excessive null/NaN token dumps', () => {
    const g = new ResponseGuardian();
    const text = 'null null null null null NaN NaN NaN NaN values from broken parser';
    const res = g.analyze(text, 'co se pokazilo?');
    expect(res.issues.some((i: string) => i.includes('Nadměrný výskyt null'))).to.be.true;
    expect(res.issues.some((i: string) => i.includes('Nadměrný výskyt NaN'))).to.be.true;
  });

  it('should truncate very long responses', () => {
    const g = new ResponseGuardian();
    const longText = 'a '.repeat(30000);
    const res = g.analyze(longText, 'prompt');
    expect(res.cleanedResponse.length).to.be.lessThan(longText.length);
    expect(res.issues.some((i: string) => i.includes('příliš dlouhá'))).to.be.true;
  });

  it('should reset history', () => {
    const g = new ResponseGuardian();
    g.analyze('First response', 'prompt1');
    g.analyze('Second response', 'prompt2');
    g.resetHistory();
    // After reset, similar response should not be detected
    const res = g.analyze('First response', 'prompt1');
    expect(res.issues).to.not.include('Odpověď je velmi podobná předchozí - model může být zaseklý');
  });

  it('should trigger similar-response block for different prompt intent', () => {
    const g = new ResponseGuardian();
    const repeated = 'Toto je stabilni odpoved na technicky dotaz s dostatkem detailu.';
    g.analyze(repeated, 'Jak presne nastavit lint pravidla v TypeScript projektu s ESLint konfiguraci?');
    const res = g.analyze(repeated, 'Jak nasadit docker image do registry a nastavit release pipeline v CI?');
    expect(res.issues).to.include('Odpověď je velmi podobná předchozí - model může být zaseklý');
    expect(res.shouldRetry).to.be.true;
  });

  it('should not trigger similar-response block for repeated same prompt intent', () => {
    const g = new ResponseGuardian();
    const repeated = 'Toto je stabilni odpoved na technicky dotaz s dostatkem detailu.';
    g.analyze(repeated, 'Jak nastavit lint v projektu?');
    const res = g.analyze(repeated, 'Jak nastavit lint v projektu?');
    expect(res.issues).to.not.include('Odpověď je velmi podobná předchozí - model může být zaseklý');
  });

  it('should not trigger similar-response block for short repeated replies', () => {
    const g = new ResponseGuardian();
    const repeated = 'Ano, jdu na to.';
    g.analyze(repeated, 'Potvrdis?');
    const res = g.analyze(repeated, 'Jdeme dal?');
    expect(res.issues).to.not.include('Odpověď je velmi podobná předchozí - model může být zaseklý');
    expect(res.shouldRetry).to.be.false;
  });

  // ── Truncation detection & auto-repair ──────────────────────────

  it('should auto-close unclosed code fence', () => {
    const g = new ResponseGuardian();
    const text = 'Here is the code:\n```typescript\nconst x = 1;\nconst y = 2;';
    const res = g.analyze(text, 'show me code');
    expect(res.cleanedResponse).to.include('```\n\n[⚠️');
    expect(res.issues.some((i: string) => i.includes('automaticky opraven'))).to.be.true;
  });

  it('should not modify response with matched code fences', () => {
    const g = new ResponseGuardian();
    const text = 'Here is the code:\n```typescript\nconst x = 1;\n```\nDone.';
    const res = g.analyze(text, 'show me code');
    expect(res.cleanedResponse).to.not.include('[⚠️');
    expect(res.issues.some((i: string) => i.includes('automaticky opraven'))).to.be.false;
  });

  it('should detect mid-sentence truncation', () => {
    const g = new ResponseGuardian();
    const text = 'This is a complete sentence. But this one ends abruptly without any finishing punctuation and keeps going on for a while to be long enough to trigger the';
    const res = g.analyze(text, 'explain something');
    expect(res.cleanedResponse).to.include('…');
    expect(res.cleanedResponse).to.include('zkrácena');
    expect(res.issues.some((i: string) => i.includes('uprostřed věty'))).to.be.true;
  });

  it('should not flag response ending with period as truncated', () => {
    const g = new ResponseGuardian();
    const text = 'This is a complete response that ends properly with a period.';
    const res = g.analyze(text, 'question');
    expect(res.issues.some((i: string) => i.includes('uprostřed věty'))).to.be.false;
  });

  it('should not flag response ending with code fence as truncated', () => {
    const g = new ResponseGuardian();
    const text = 'Here:\n```typescript\nconst x = 1;\n```';
    const res = g.analyze(text, 'show code');
    expect(res.issues.some((i: string) => i.includes('uprostřed věty'))).to.be.false;
  });

  it('should not flag short responses for mid-sentence truncation', () => {
    const g = new ResponseGuardian();
    const text = 'Short answer here';
    const res = g.analyze(text, 'question');
    expect(res.issues.some((i: string) => i.includes('uprostřed věty'))).to.be.false;
  });

  it('should not flag response ending with closing bracket', () => {
    const g = new ResponseGuardian();
    const text = 'The function returns the result of the computation (as described above)';
    const res = g.analyze(text, 'question');
    expect(res.issues.some((i: string) => i.includes('uprostřed věty'))).to.be.false;
  });

  it('should track truncation repairs in stats', () => {
    const g = new ResponseGuardian();
    const text = 'Here is the code:\n```typescript\nconst x = 1;';
    g.analyze(text, 'code');
    const stats = g.getStats();
    expect(stats.truncationsRepaired).to.be.greaterThan(0);
  });
});

describe('HallucinationDetector', () => {
  it('should detect no hallucination in clean response', () => {
    const detector = new HallucinationDetector();
    const res = detector.analyze(
      'Zde je kód pro sečtení dvou čísel:\n```javascript\nconst sum = a + b;\n```',
      'Jak sečtu dvě čísla?',
      []
    );
    expect(res.isHallucination).to.be.false;
    expect(res.confidence).to.be.lessThan(0.5);
  });

  it('should detect self-reference hallucination', () => {
    const detector = new HallucinationDetector();
    const res = detector.analyze(
      'Jako AI nemám přístup k internetu a nemohu vidět obrázky.',
      'Popiš tento obrázek',
      []
    );
    expect(res.confidence).to.be.greaterThan(0);
    expect(res.category === 'self-reference' || res.reasons.some((r: string) => r.includes('AI'))).to.be.true;
  });

  it('should detect contextual hallucination (referencing non-existent previous)', () => {
    const detector = new HallucinationDetector();
    const res = detector.analyze(
      'Jak jsem již zmínil v předchozí odpovědi, toto je důležité.',
      'První otázka',
      [] // Empty history
    );
    expect(res.confidence).to.be.greaterThan(0.3);
    expect(res.reasons.some((r: string) => r.includes('neexistující') || r.includes('zmínil'))).to.be.true;
  });

  it('should not flag contextual reference when history exists', () => {
    const detector = new HallucinationDetector();
    const res = detector.analyze(
      'Jak jsem již zmínil, toto je důležité.',
      'Další otázka',
      [
        { role: 'user', content: 'První otázka' },
        { role: 'assistant', content: 'První odpověď' },
        { role: 'user', content: 'Další otázka' }
      ]
    );
    // Should have lower confidence when history exists
    expect(res.confidence).to.be.lessThan(0.6);
  });

  it('should detect factual hallucination patterns', () => {
    const detector = new HallucinationDetector();
    const res = detector.analyze(
      'Podle mých informací z roku 2024, není pochyb o tom, že fakta jsou taková.',
      'Co je pravda?',
      []
    );
    expect(res.confidence).to.be.greaterThan(0.3);
  });

  it('should not flag code blocks as hallucination', () => {
    const detector = new HallucinationDetector();
    const res = detector.analyze(
      '```javascript\nconst jako = "AI";\nfunction nemám() {}\n```',
      'Ukaž kód',
      []
    );
    // Code blocks should be filtered out
    expect(res.isHallucination).to.be.false;
  });

  it('should detect suspicious URLs', () => {
    const detector = new HallucinationDetector();
    const res = detector.analyze(
      'Podívej se na https://example.com/very/specific/path/to/resource/that/does/not/exist.html',
      'Kde najdu dokumentaci?',
      []
    );
    expect(res.reasons.some((r: string) => r.includes('URL'))).to.be.true;
  });

  it('should not flag known host URL when host is requested by user', () => {
    const detector = new HallucinationDetector();
    const res = detector.analyze(
      'Dokumentace je na https://docs.example.com/getting-started.',
      'Mas link na docs.example.com?',
      []
    );
    expect(res.reasons.some((r: string) => r.includes('URL'))).to.be.false;
  });

  it('should flag random-like long URL path even without explicit prompt URL', () => {
    const detector = new HallucinationDetector();
    const res = detector.analyze(
      'Zkus https://example.com/api/v1/resources/abc123def456ghi789jkl012mno345/payload/details/report.',
      'Kde najdu report?',
      []
    );
    expect(res.reasons.some((r: string) => r.includes('URL'))).to.be.true;
  });

  it('should provide correct summary for no hallucination', () => {
    const detector = new HallucinationDetector();
    const result = {
      isHallucination: false,
      confidence: 0.1,
      reasons: [] as string[],
      category: 'none' as const
    };
    const summary = detector.getSummary(result);
    expect(summary).to.include('✅');
  });

  it('should provide correct summary for possible hallucination', () => {
    const detector = new HallucinationDetector();
    const result = {
      isHallucination: false,
      confidence: 0.4,
      reasons: ['test'],
      category: 'factual' as const
    };
    const summary = detector.getSummary(result);
    expect(summary).to.include('⚠️');
  });

  it('should provide correct summary for probable hallucination', () => {
    const detector = new HallucinationDetector();
    const result = {
      isHallucination: true,
      confidence: 0.8,
      reasons: ['test'],
      category: 'contextual' as const
    };
    const summary = detector.getSummary(result);
    expect(summary).to.include('🚨');
    expect(summary).to.include('contextual');
  });
});
