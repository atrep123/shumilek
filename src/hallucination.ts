import { HallucinationResult, ChatMessage } from './types';

// Logger function - can be set by extension
let logFn: ((msg: string) => void) | undefined;

export function setHallucinationLogger(fn: (msg: string) => void): void {
  logFn = fn;
}

interface HallucinationPattern {
  pattern: RegExp;
  category: 'self-reference' | 'factual' | 'contextual';
  weight: number;
}

export class HallucinationDetector {
  private readonly HALLUCINATION_PATTERNS: HallucinationPattern[] = [
    // Self-reference hallucinations
    { pattern: /jako\s+(AI|umělá\s+inteligence|jazykový\s+model)/gi, category: 'self-reference', weight: 0.3 },
    { pattern: /nemám\s+(přístup|schopnost|možnost)/gi, category: 'self-reference', weight: 0.2 },
    { pattern: /nemohu\s+(vidět|slyšet|cítit)/gi, category: 'self-reference', weight: 0.2 },
    
    // Factual hallucination indicators
    { pattern: /podle\s+mých\s+informací\s+z\s+roku\s+\d{4}/gi, category: 'factual', weight: 0.4 },
    { pattern: /fakta?\s+(?:je|jsou),?\s+že/gi, category: 'factual', weight: 0.3 },
    { pattern: /je\s+všeobecně\s+známo/gi, category: 'factual', weight: 0.3 },
    
    // Contextual hallucinations
    { pattern: /jak\s+jsem\s+(?:již\s+)?(?:zmínil|řekl|uvedl)/gi, category: 'contextual', weight: 0.5 },
    { pattern: /v\s+předchozí\s+(?:odpovědi|zprávě)/gi, category: 'contextual', weight: 0.4 },
    { pattern: /(?:výše|dříve)\s+(?:zmíněný|uvedený)/gi, category: 'contextual', weight: 0.3 },
    
    // Confidence without basis
    { pattern: /(?:určitě|jistě|rozhodně)\s+(?:je|jsou|bude)/gi, category: 'factual', weight: 0.2 },
    { pattern: /není\s+pochyb/gi, category: 'factual', weight: 0.3 },
  ];

  private readonly SAFE_PATTERNS: RegExp[] = [
    /```[\s\S]*?```/g,  // fenced code blocks
    /`[^`\n]+`/g,       // inline code spans
  ];

  private isSuspiciousUrl(url: string, userPrompt: string): boolean {
    const promptLower = userPrompt.toLowerCase();
    const normalizedUrl = url.toLowerCase();
    if (promptLower.includes(normalizedUrl)) {
      return false;
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return true;
    }

    const host = parsed.host.toLowerCase();
    if (host && promptLower.includes(host)) {
      return false;
    }

    const path = parsed.pathname || '';
    const segments = path.split('/').filter(Boolean);
    const hasVeryLongPath = path.length > 70;
    const hasManySegments = segments.length >= 5;
    const hasRandomLikeSegment = segments.some(segment => /[a-z0-9]{22,}/i.test(segment));

    return hasVeryLongPath || hasManySegments || hasRandomLikeSegment;
  }

  private hasFollowupIntent(userPrompt: string): boolean {
    const prompt = userPrompt.toLowerCase();
    return /(?:pokracuj|pokračuj|navaz|navaž|doplň|dopln|rozved|rozveď|zopakuj|shrň|sumarizuj|co\s+jsi\s+(?:psal|uvedl|zminil|zmínil)|jak\s+jsi\s+(?:psal|uvedl|zminil|zmínil)|continue|go\s+on|elaborate|expand|carry\s+on|keep\s+going|what\s+(?:you|did\s+you)\s+(?:said|mentioned|wrote))/i.test(prompt);
  }

  private hasUncertaintyHedge(text: string): boolean {
    return /(?:možná|mozna|pravděpodobně|pravdepodobne|nejspíš|nejspis|zřejmě|zrejme|může\s+být|muze\s+byt|nemusí\s+být|nemusi\s+byt|odhadem|tipuji|tipuju)/i.test(text);
  }

  analyze(response: string, userPrompt: string, conversationHistory: ChatMessage[]): HallucinationResult {
    // Snapshot the logger to avoid races if setHallucinationLogger() is
    // called while this method is running.
    const log = logFn;

    const result: HallucinationResult = {
      isHallucination: false,
      confidence: 0,
      reasons: [],
      category: 'none'
    };

    // Remove safe patterns (code blocks) from analysis
    let textToAnalyze = response;
    for (const safePattern of this.SAFE_PATTERNS) {
      textToAnalyze = textToAnalyze.replace(safePattern, '');
    }

    // Check for hallucination patterns
    let totalWeight = 0;
    const categoryWeights: Record<string, number> = {};

    for (const { pattern, category, weight } of this.HALLUCINATION_PATTERNS) {
      const matches = textToAnalyze.match(pattern);
      if (matches && matches.length > 0) {
        const matchWeight = weight * matches.length;
        totalWeight += matchWeight;
        categoryWeights[category] = (categoryWeights[category] || 0) + matchWeight;
        result.reasons.push(`Detekován vzor: "${matches[0].slice(0, 50)}..."`);
      }
    }

    // Check for contextual hallucinations (referencing non-existent previous content)
    if (conversationHistory.length < 2) {
      const contextualRefs = textToAnalyze.match(/jak\s+jsem\s+(?:již\s+)?(?:zmínil|řekl)/gi);
      if (contextualRefs) {
        if (this.hasFollowupIntent(userPrompt)) {
          result.reasons.push('Kontextová reference byla vyžádána promptem uživatele');
        } else {
          // Only add extra weight if the main pattern loop didn't already
          // match contextual patterns (avoid double-counting).
          const alreadyCounted = categoryWeights['contextual'] || 0;
          if (alreadyCounted === 0) {
            totalWeight += 0.6;
            categoryWeights['contextual'] = 0.6;
          }
          result.reasons.push('Reference na neexistující předchozí konverzaci');
        }
      }
    }

    // Check for invented URLs or file paths
    const urlPattern = /https?:\/\/[^\s]+\.(?:com|org|cz|io|dev|ai|app|cloud|co|uk|net|me|tv|sk|de|eu|info|xyz|pl|ru|fr|es|it|nl|se|no|fi|at|ch|hu|hr|si|rs|bg|ro|ua|lt|lv|ee|be|dk|pt|ie|is|lu|gr|cy|mt|li|mc|ad|sm|va|ws|su)[^\s]*/gi;
    const urls = textToAnalyze.match(urlPattern);
    if (urls && urls.length > 0) {
      for (const url of urls) {
        if (this.isSuspiciousUrl(url, userPrompt)) {
          totalWeight += 0.3;
          categoryWeights['factual'] = (categoryWeights['factual'] || 0) + 0.3;
          result.reasons.push(`Potenciálně vymyšlená URL: ${url.slice(0, 40)}...`);
        }
      }
    }

    if (categoryWeights['factual'] && this.hasUncertaintyHedge(textToAnalyze)) {
      const originalFactual = categoryWeights['factual'];
      const reduction = Math.min(originalFactual * 0.35, 0.35);
      categoryWeights['factual'] = Math.max(0, originalFactual - reduction);
      totalWeight = Math.max(0, totalWeight - reduction);
      result.reasons.push('Faktická jistota snížena kvůli nejistému/hedged jazyku');
    }

    // Calculate confidence and determine if hallucination
    result.confidence = Math.min(1, totalWeight);

    // Determine primary category
    if (Object.keys(categoryWeights).length > 0) {
      const maxCategory = Object.entries(categoryWeights)
        .sort((a, b) => b[1] - a[1])[0];
      result.category = maxCategory[0] as HallucinationResult['category'];
    }

    const hasOnlySelfRef = Object.keys(categoryWeights).length === 1 && categoryWeights['self-reference'];
    if (hasOnlySelfRef) {
      result.confidence = Math.min(result.confidence, 0.4);
    }
    result.isHallucination = result.confidence > 0.5;

    // Log to output
    if (result.isHallucination || result.confidence > 0.3) {
      log?.(`[HallucinationDetector] ⚠️ Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      log?.(`[HallucinationDetector] Category: ${result.category}`);
      result.reasons.forEach(r => log?.(`[HallucinationDetector]   - ${r}`));
    }

    return result;
  }

  getSummary(result: HallucinationResult): string {
    if (!result.isHallucination && result.confidence < 0.3) {
      return '✅ Žádné halucinace';
    }
    if (result.confidence < 0.5) {
      return `⚠️ Možná halucinace (${(result.confidence * 100).toFixed(0)}%)`;
    }
    return `🚨 Pravděpodobná halucinace: ${result.category} (${(result.confidence * 100).toFixed(0)}%)`;
  }
}
