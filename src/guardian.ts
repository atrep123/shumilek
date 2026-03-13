import { GuardianResult, GuardianStats } from './types';

// Stats storage - shared with extension
let guardianStats: GuardianStats = {
  totalChecks: 0,
  loopsDetected: 0,
  repetitionsFixed: 0,
  retriesTriggered: 0,
  miniModelValidations: 0,
  miniModelRejections: 0,
  hallucinationsDetected: 0,
  similarResponsesBlocked: 0,
  truncationsRepaired: 0
};

// Logger function - can be set by extension
let logFn: ((msg: string) => void) | undefined;

export function setGuardianLogger(fn: (msg: string) => void): void {
  logFn = fn;
}

export function setGuardianStats(stats: GuardianStats): void {
  guardianStats = stats;
}

export function getGuardianStatsRef(): GuardianStats {
  return guardianStats;
}

export class ResponseGuardian {
  private readonly MIN_RESPONSE_LENGTH = 5;
  private readonly MAX_RESPONSE_LENGTH = 50000;
  private readonly MAX_ANALYSIS_CHARS = 5000;
  private readonly LOOP_THRESHOLD = 3;
  private readonly REPETITION_THRESHOLD = 0.4;
  private readonly MIN_PATTERN_LENGTH = 10;
  private previousResponses: string[] = [];
  private previousPrompts: string[] = [];

  analyze(response: string, userPrompt: string): GuardianResult {
    guardianStats.totalChecks++;
    
    logFn?.(`[Guardian] Analyzing response (${response.length} chars) for prompt: "${userPrompt.slice(0, 50)}..."`);
    
    const issues: string[] = [];
    let cleanedResponse = response;
    let shouldRetry = false;
    let loopDetected = false;

    const analysisText = this.truncateForAnalysis(response);

    // 1. Check for empty/too short response
    if (!response || response.trim().length < this.MIN_RESPONSE_LENGTH) {
      issues.push('Prázdná nebo příliš krátká odpověď');
      shouldRetry = true;
    }

    // 2. Check for too long response
    if (response.length > this.MAX_RESPONSE_LENGTH) {
      issues.push('Odpověď je příliš dlouhá - možné nekonečné generování');
      cleanedResponse = response.slice(0, this.MAX_RESPONSE_LENGTH) + '\n\n[Odpověď zkrácena]';
    }

    // 3. Detect loops
    const loopResult = this.detectLoop(analysisText);
    if (loopResult.detected) {
      loopDetected = true;
      guardianStats.loopsDetected++;
      const patternPreview = loopResult.pattern ? loopResult.pattern.slice(0, 50) : 'neznámý vzor';
      issues.push(`Detekována smyčka: "${patternPreview}..."`);
      if (loopResult.pattern) {
        cleanedResponse = this.removeLoop(response, loopResult.pattern);
      }
      shouldRetry = loopResult.severity === 'high';
    }

    // 4. Detect word/phrase repetition
    const repetitionScore = this.calculateRepetitionScore(analysisText);
    if (repetitionScore > this.REPETITION_THRESHOLD) {
      issues.push(`Vysoké opakování slov (${Math.round(repetitionScore * 100)}%)`);
      cleanedResponse = this.reduceRepetition(cleanedResponse);
      guardianStats.repetitionsFixed++;
    }

    // 5. Compare with previous responses
    if (this.isSimilarToPrevious(analysisText, userPrompt)) {
      issues.push('Odpověď je velmi podobná předchozí - model může být zaseklý');
      shouldRetry = true;
    }

    // 6. Check for common error patterns
    const errorPatterns = this.detectErrorPatterns(analysisText);
    if (errorPatterns.length > 0) {
      issues.push(...errorPatterns);
      
      const criticalPatterns = ['Slitý text', 'halucinace', 'bez mezer'];
      const hasCritical = errorPatterns.some(e => 
        criticalPatterns.some(p => e.toLowerCase().includes(p.toLowerCase()))
      );
      if (hasCritical) {
        logFn?.(`[Guardian] 🚨 KRITICKÁ CHYBA - vyžadován retry`);
        shouldRetry = true;
      }
    }

    this.addToPreviousResponses(cleanedResponse, userPrompt);

    // 7. Detect and repair truncated responses (unclosed fences, mid-sentence)
    const truncationResult = this.detectAndRepairTruncation(cleanedResponse);
    if (truncationResult.repaired) {
      cleanedResponse = truncationResult.text;
      issues.push(...truncationResult.issues);
      guardianStats.truncationsRepaired++;
      logFn?.(`[Guardian] Truncation repaired: ${truncationResult.issues.join('; ')}`);
    }

    if (shouldRetry) {
      guardianStats.retriesTriggered++;
    }

    return {
      isOk: issues.length === 0,
      cleanedResponse,
      issues,
      shouldRetry,
      loopDetected,
      repetitionScore
    };
  }

  private detectLoop(text: string): { detected: boolean; pattern?: string; severity: 'low' | 'medium' | 'high' } {
    const codePoints = [...text];
    const maxPatternLen = Math.min(200, Math.floor(codePoints.length / 3));
    const startTime = Date.now();
    const MAX_CHECKS = 8000;
    const MAX_TIME_MS = 25;
    let checks = 0;

    if (codePoints.length === 0 || maxPatternLen < this.MIN_PATTERN_LENGTH) {
      return { detected: false, severity: 'low' };
    }

    outer: for (let patternLen = this.MIN_PATTERN_LENGTH; patternLen <= maxPatternLen; patternLen++) {
      for (let start = 0; start + patternLen * 2 <= codePoints.length; start++) {
        if (++checks > MAX_CHECKS || (Date.now() - startTime) > MAX_TIME_MS) {
          break outer;
        }
        const pattern = codePoints.slice(start, start + patternLen).join('');

        const nonWsRatio = pattern.replace(/\s+/g, '').length / pattern.length;
        if (nonWsRatio < 0.5) continue;

        let count = 0;
        let pos = 0;
        while (pos <= codePoints.length - patternLen) {
          const chunk = codePoints.slice(pos, pos + patternLen).join('');
          if (chunk === pattern) {
            count++;
            pos += patternLen;
          } else {
            pos++;
          }
        }

        if (count >= this.LOOP_THRESHOLD) {
          const severity = count >= 10 ? 'high' : count >= 5 ? 'medium' : 'low';
          return { detected: true, pattern, severity };
        }
      }
    }

    const charRepeatMatch = text.match(/(.)\1{20,}/us);
    if (charRepeatMatch) {
      return { detected: true, pattern: charRepeatMatch[0], severity: 'high' };
    }

    return { detected: false, severity: 'low' };
  }

  private removeLoop(text: string, pattern: string): string {
    if (!pattern || pattern.length === 0) {
      return text;
    }
    
    let count = 0;
    let result = '';
    let remaining = text;
    
    while (remaining.length > 0) {
      const idx = remaining.indexOf(pattern);
      if (idx === -1) {
        result += remaining;
        break;
      }
      
      if (count < 2) {
        result += remaining.slice(0, idx + pattern.length);
        count++;
      }
      remaining = remaining.slice(idx + pattern.length);
    }

    return result.trim() + '\n\n[⚠️ Smyčka odstraněna]';
  }

  private calculateRepetitionScore(text: string): number {
    if (text.length < 50) return 0;

    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (words.length < 10) return 0;

    const wordCount = new Map<string, number>();
    words.forEach(word => {
      wordCount.set(word, (wordCount.get(word) || 0) + 1);
    });

    let repeatedCount = 0;
    wordCount.forEach((count) => {
      if (count > 2) {
        repeatedCount += count - 2;
      }
    });

    return repeatedCount / words.length;
  }

  private reduceRepetition(text: string): string {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const seenSentences = new Set<string>();
    const result: string[] = [];

    for (const sentence of sentences) {
      const normalized = sentence.toLowerCase().trim();
      if (!normalized) continue;
      
      const similarCount = [...seenSentences].filter(s => 
        this.similarity(s, normalized) > 0.8
      ).length;
      
      if (similarCount < 2) {
        result.push(sentence);
        seenSentences.add(normalized);
      }
    }

    return result.length > 0 ? result.join(' ') : text;
  }

  private similarity(a: string, b: string): number {
    if (!a || !b || typeof a !== 'string' || typeof b !== 'string') {
      return 0;
    }
    
    const setA = new Set(a.split(/\s+/).filter(w => w.length > 0));
    const setB = new Set(b.split(/\s+/).filter(w => w.length > 0));
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    
    if (union.size === 0) {
      return 0;
    }
    
    return intersection.size / union.size;
  }

  private isSimilarToPrevious(response: string, userPrompt: string): boolean {
    const candidate = this.truncateForAnalysis(response).toLowerCase();
    const promptCandidate = this.truncateForAnalysis(userPrompt).toLowerCase();
    for (let i = 0; i < this.previousResponses.length; i++) {
      const prev = this.previousResponses[i];
      if (this.similarity(prev, candidate) > 0.9) {
        const prevPrompt = this.previousPrompts[i] ?? '';
        const isSamePromptIntent = this.similarity(prevPrompt, promptCandidate) > 0.85;
        if (isSamePromptIntent) {
          continue;
        }
        return true;
      }
    }
    return false;
  }

  private addToPreviousResponses(response: string, userPrompt: string): void {
    const snapshot = this.truncateForAnalysis(response).toLowerCase();
    const promptSnapshot = this.truncateForAnalysis(userPrompt).toLowerCase();
    this.previousResponses.push(snapshot);
    this.previousPrompts.push(promptSnapshot);
    if (this.previousResponses.length > 5) {
      this.previousResponses.shift();
      this.previousPrompts.shift();
    }
  }

  private truncateForAnalysis(text: string): string {
    if (text.length <= this.MAX_ANALYSIS_CHARS) {
      return text;
    }
    if (text.length > 1000000) {
      return text.slice(0, this.MAX_ANALYSIS_CHARS);
    }
    return [...text].slice(0, this.MAX_ANALYSIS_CHARS).join('');
  }

  private detectErrorPatterns(text: string): string[] {
    const issues: string[] = [];
    const safeText = text.length > 10000 ? text.slice(0, 10000) : text;

    // Detect glued text without spaces
    const gluedTextMatch = safeText.match(/[a-záčďéěíňóřšťúůýž]{45,}/gi);
    if (gluedTextMatch) {
      issues.push(`Slitý text bez mezer (${gluedTextMatch[0].slice(0, 30)}...)`);
      logFn?.(`[ResponseGuardian] 🚨 KRITICKÉ: Slitý text detekován: ${gluedTextMatch[0].slice(0, 50)}`);
    }

    // Detect text with very low space ratio at the end
    const lastPart = safeText.slice(-500);
    const spaceRatio = (lastPart.match(/\s/g) || []).length / Math.max(lastPart.length, 1);
    if (lastPart.length > 100 && spaceRatio < 0.08) {
      issues.push('Konec textu bez mezer (halucinace)');
      logFn?.(`[ResponseGuardian] 🚨 KRITICKÉ: Konec textu má pouze ${(spaceRatio * 100).toFixed(1)}% mezer!`);
    }

    // Detect overly long "words"
    const words = safeText.split(/\s+/);
    const longWords = words.filter(w => w.length > 35);
    if (longWords.length > 2) {
      issues.push(`Příliš dlouhá slova (${longWords.length}x) - možný slitý text`);
      logFn?.(`[ResponseGuardian] 🚨 Dlouhá slova: ${longWords.slice(0, 3).join(', ')}`);
    }

    const stuckPatterns: Array<{ pattern: RegExp; msg: string }> = [
      { pattern: /\[END\].*\[END\]/gi, msg: 'Opakující se [END] značky' },
      { pattern: /<\|.*\|>.*<\|.*\|>/gi, msg: 'Opakující se speciální tokeny' },
      { pattern: /\n{10,}/g, msg: 'Příliš mnoho prázdných řádků' },
      { pattern: /\.{20,}/g, msg: 'Opakující se tečky' },
      { pattern: /_{20,}/g, msg: 'Opakující se podtržítka' },
      { pattern: /-{20,}/g, msg: 'Opakující se pomlčky' },
      { pattern: /={20,}/g, msg: 'Opakující se rovnítka' },
      { pattern: /\*{15,}/g, msg: 'Opakující se hvězdičky' },
      { pattern: /#####.*#####/g, msg: 'Opakující se nadpisy' },
      { pattern: /\(undefined\)/gi, msg: 'Undefined hodnoty v textu' },
      { pattern: /\[object Object\]/gi, msg: 'Nevypsaný objekt v textu' },
      { pattern: /NaN/g, msg: 'NaN hodnoty v textu' },
      { pattern: /null/gi, msg: 'Null hodnoty v textu (možná chyba)' },
      { pattern: /TODO:|FIXME:|XXX:/gi, msg: 'Neodstraněné TODO/FIXME značky' },
      { pattern: /lorem ipsum/gi, msg: 'Placeholder text (Lorem Ipsum)' },
      { pattern: /example\.com|foo\.bar/gi, msg: 'Placeholder URL/domény' },
      { pattern: /(\w)\1{8,}/g, msg: 'Opakující se znaky (halucinace)' },
    ];

    for (const { pattern, msg } of stuckPatterns) {
      if (pattern.test(safeText)) {
        issues.push(msg);
        logFn?.(`[ResponseGuardian] ⚠️ Error pattern: ${msg}`);
      }
    }

    const codeBlockStarts = (safeText.match(/```/g) || []).length;
    if (codeBlockStarts % 2 !== 0) {
      issues.push('Neuzavřený blok kódu');
      logFn?.('[ResponseGuardian] ⚠️ Neuzavřený blok kódu detekován');
    }

    const brokenLinks = safeText.match(/\[([^\]]*)\]\(\s*\)/g);
    if (brokenLinks && brokenLinks.length > 0) {
      issues.push(`Prázdné markdown odkazy (${brokenLinks.length}x)`);
      logFn?.(`[ResponseGuardian] ⚠️ Prázdné markdown odkazy: ${brokenLinks.length}`);
    }

    const emojiCount = (safeText.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
    if (emojiCount > 20) {
      issues.push(`Příliš mnoho emoji (${emojiCount})`);
      logFn?.(`[ResponseGuardian] ⚠️ Nadměrné použití emoji: ${emojiCount}`);
    }

    const sentences = safeText.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const sentenceSet = new Set<string>();
    let duplicateSentences = 0;
    for (const sentence of sentences) {
      const normalized = sentence.toLowerCase().trim();
      if (sentenceSet.has(normalized)) {
        duplicateSentences++;
      } else {
        sentenceSet.add(normalized);
      }
    }
    if (duplicateSentences > 3) {
      issues.push(`Opakující se věty (${duplicateSentences}x)`);
      logFn?.(`[ResponseGuardian] ⚠️ Opakující se věty: ${duplicateSentences}`);
    }

    return issues;
  }

  getStats(): GuardianStats {
    return { ...guardianStats };
  }

  resetHistory(): void {
    this.previousResponses = [];
    this.previousPrompts = [];
  }

  /**
   * Detect truncated responses and auto-repair them.
   * Handles: unclosed code fences, mid-sentence cuts.
   */
  private detectAndRepairTruncation(text: string): { text: string; repaired: boolean; issues: string[] } {
    let result = text;
    let repaired = false;
    const issues: string[] = [];

    // 1. Repair unclosed code fences
    const fenceCount = (result.match(/```/g) || []).length;
    if (fenceCount % 2 !== 0) {
      result = result.trimEnd() + '\n```\n\n[⚠️ Kód byl automaticky uzavřen — odpověď mohla být zkrácena]';
      repaired = true;
      issues.push('Neuzavřený blok kódu automaticky opraven');
    }

    // 2. Detect mid-sentence truncation
    // Only check if response is long enough and doesn't already end with a fence-repair marker
    if (!repaired && result.length > 60) {
      const trimmed = result.trimEnd();
      // Get last meaningful line (skip empty lines)
      const lines = trimmed.split('\n');
      let lastLine = '';
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i].trim();
        if (l.length > 0) {
          lastLine = l;
          break;
        }
      }

      if (lastLine.length > 0) {
        const lastChar = lastLine[lastLine.length - 1];
        // Acceptable endings: sentence punctuation, code fence, closing brackets, list/heading markers
        const validEndings = /[.!?;:)\]}>`"'\-—…*#|\\]$/;
        const isCodeFence = lastLine.startsWith('```');
        const isListOrHeading = /^[-*+#>|\d]/.test(lastLine);
        const endsWithWord = /\w$/.test(lastLine);

        if (endsWithWord && !validEndings.test(lastLine) && !isCodeFence && !isListOrHeading && lastLine.length > 15) {
          result = trimmed + '…\n\n[⚠️ Odpověď byla pravděpodobně zkrácena]';
          repaired = true;
          issues.push('Odpověď končí uprostřed věty — pravděpodobně zkrácena modelem');
        }
      }
    }

    return { text: result, repaired, issues };
  }
}
