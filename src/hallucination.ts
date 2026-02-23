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
    /```[\s\S]*?```/g,
    /\b(?:function|class|const|let|var|import|export)\b/gi,
  ];

  analyze(response: string, userPrompt: string, conversationHistory: ChatMessage[]): HallucinationResult {
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
        totalWeight += 0.6;
        categoryWeights['contextual'] = (categoryWeights['contextual'] || 0) + 0.6;
        result.reasons.push('Reference na neexistující předchozí konverzaci');
      }
    }

    // Check for invented URLs or file paths
    const urlPattern = /https?:\/\/[^\s]+\.(com|org|cz|io|dev)[^\s]*/gi;
    const urls = textToAnalyze.match(urlPattern);
    if (urls && urls.length > 0) {
      for (const url of urls) {
        if (url.length > 50 && !userPrompt.includes(url.slice(0, 20))) {
          totalWeight += 0.3;
          result.reasons.push(`Potenciálně vymyšlená URL: ${url.slice(0, 40)}...`);
        }
      }
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
      logFn?.(`[HallucinationDetector] ⚠️ Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      logFn?.(`[HallucinationDetector] Category: ${result.category}`);
      result.reasons.forEach(r => logFn?.(`[HallucinationDetector]   - ${r}`));
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
