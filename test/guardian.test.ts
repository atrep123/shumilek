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

  it('should trigger retry for medium loop with high repetition', () => {
    const g = new ResponseGuardian();
    const text = 'opakuj toto stale dokola bez konce '.repeat(6);
    const res = g.analyze(text, 'Vysvetli detailne krok po kroku tento postup v delsim textu');
    expect(res.loopDetected).to.be.true;
    expect(res.shouldRetry).to.be.true;
    expect(res.issues.some((i: string) => i.includes('Středně závažná smyčka'))).to.be.true;
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

  it('should not flag single example.com mention in normal explanation', () => {
    const g = new ResponseGuardian();
    const text = 'Pro ukazku endpointu muze byt pouzita domena example.com v dokumentaci.';
    const res = g.analyze(text, 'Dej priklad domény do dokumentace');
    expect(res.issues.some((i: string) => i.includes('Placeholder URL/domény'))).to.be.false;
  });

  it('should flag repeated placeholder URL/domain usage', () => {
    const g = new ResponseGuardian();
    const text = 'Pouzij example.com, pak https://example.com/api a nakonec foo.bar/test pro demo.';
    const res = g.analyze(text, 'Vytvor mi fake data pro demo');
    expect(res.issues.some((i: string) => i.includes('Placeholder URL/domény'))).to.be.true;
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

  it('should not flag null/NaN inside code blocks as excessive', () => {
    const g = new ResponseGuardian();
    const text = 'Pokud chcete zkontrolovat null a NaN:\n```javascript\nif (val === null) { return null; }\nif (Number.isNaN(val)) { console.log("NaN detected"); }\nconst result = val ?? null;\n```\nTakhle to funguje.';
    const res = g.analyze(text, 'Jak zkontrolovat null?');
    expect(res.issues.some((i: string) => i.includes('null hodnot'))).to.be.false;
    expect(res.issues.some((i: string) => i.includes('NaN hodnot'))).to.be.false;
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

  // ── Code-block false-positive prevention ────────────────────────

  it('should not flag TODO inside a code block', () => {
    const g = new ResponseGuardian();
    const text = 'Zde je priklad:\n```typescript\n// TODO: implement validation\nfunction validate() {}\n```\nTo je vse.';
    const res = g.analyze(text, 'Dej mi priklad funkce');
    expect(res.issues.some((i: string) => i.includes('TODO/FIXME'))).to.be.false;
  });

  it('should still flag TODO outside code blocks', () => {
    const g = new ResponseGuardian();
    const text = 'Tohle je hotove. TODO: doplnit dokumentaci.';
    const res = g.analyze(text, 'prompt');
    expect(res.issues.some((i: string) => i.includes('TODO/FIXME'))).to.be.true;
  });

  it('should not flag [object Object] inside a code block', () => {
    const g = new ResponseGuardian();
    const text = 'Pozor na tuto chybu:\n```javascript\nconsole.log(obj); // [object Object]\n```\nPouzijte JSON.stringify.';
    const res = g.analyze(text, 'Proc vidim [object Object]?');
    expect(res.issues.some((i: string) => i.includes('Nevypsaný objekt'))).to.be.false;
  });

  it('should not flag placeholder URLs inside code blocks', () => {
    const g = new ResponseGuardian();
    const text = 'Priklad fetch volani:\n```javascript\nfetch("https://example.com/api")\n  .then(r => r.json());\nfetch("https://example.com/users");\n```\nTakhle se to dela.';
    const res = g.analyze(text, 'Jak pouzit fetch?');
    expect(res.issues.some((i: string) => i.includes('Placeholder URL'))).to.be.false;
  });

  it('should not flag lorem ipsum inside a code block', () => {
    const g = new ResponseGuardian();
    const text = 'Priklad sablony:\n```html\n<p>Lorem ipsum dolor sit amet</p>\n```\nNahradte svym textem.';
    const res = g.analyze(text, 'Dej mi HTML sablonu');
    expect(res.issues.some((i: string) => i.includes('Lorem Ipsum'))).to.be.false;
  });

  it('should not flag (undefined) inside a code block', () => {
    const g = new ResponseGuardian();
    const text = 'Vystup z konzole:\n```\nValue: (undefined)\n```\nTo znamena ze promenna nebyla nastavena.';
    const res = g.analyze(text, 'prompt');
    expect(res.issues.some((i: string) => i.includes('Undefined hodnoty'))).to.be.false;
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

  it('should reduce contextual penalty when follow-up is explicitly requested by prompt', () => {
    const detector = new HallucinationDetector();
    const res = detector.analyze(
      'Jak jsem již zmínil, toto je důležité.',
      'Pokračuj a navaž na to, co jsi už zmínil.',
      []
    );
    expect(res.confidence).to.be.at.most(0.5);
    expect(res.isHallucination).to.be.false;
    expect(res.reasons.some((r: string) => r.includes('vyžádána promptem'))).to.be.true;
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

  it('should reduce factual confidence when uncertainty hedge is present', () => {
    const detector = new HallucinationDetector();
    const strict = detector.analyze(
      'Podle mých informací z roku 2024, není pochyb o tom, že fakta jsou taková.',
      'Co je pravda?',
      []
    );
    const hedged = detector.analyze(
      'Podle mých informací z roku 2024 to možná platí, ale odhadem se to může lišit.',
      'Co je pravda?',
      []
    );

    expect(hedged.confidence).to.be.lessThan(strict.confidence);
    expect(hedged.reasons.some((r: string) => r.includes('nejistému/hedged'))).to.be.true;
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

  it('should detect suspicious URL with .ai TLD', () => {
    const detector = new HallucinationDetector();
    const res = detector.analyze(
      'Podívejte se na https://fake-api.ai/docs/v3/admin/config/endpoint pro více informací.',
      'Jak volat API?',
      []
    );
    expect(res.confidence).to.be.greaterThan(0);
  });

  it('should detect suspicious URL with .app TLD', () => {
    const detector = new HallucinationDetector();
    const res = detector.analyze(
      'Stáhněte nástroj z https://super-tool.app/download/latest/v2/bin/setup prosím.',
      'Jaký nástroj použít?',
      []
    );
    expect(res.confidence).to.be.greaterThan(0);
  });

  it('should detect suspicious URL with .cloud TLD', () => {
    const detector = new HallucinationDetector();
    const res = detector.analyze(
      'Dashboard je na https://my-service.cloud/admin/panel/settings/users/overview pro správu.',
      'Kde je dashboard?',
      []
    );
    expect(res.confidence).to.be.greaterThan(0);
  });

  it('should not flag contextual ref when English followup intent is present', () => {
    const detector = new HallucinationDetector();
    const res = detector.analyze(
      'Jak jsem již zmínil, funkce se volá takto.',
      'continue please',
      []
    );
    expect(res.reasons.some((r: string) => r.includes('vyžádána promptem'))).to.be.true;
    expect(res.reasons.some((r: string) => r.includes('neexistující'))).to.be.false;
  });

  it('should not flag contextual ref when "elaborate" is used', () => {
    const detector = new HallucinationDetector();
    const res = detector.analyze(
      'Jak jsem již zmínil, tohle je důležité.',
      'elaborate on this',
      []
    );
    expect(res.reasons.some((r: string) => r.includes('vyžádána promptem'))).to.be.true;
  });
});
