// === Types ===

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: number; // Unix ms
}

export interface ChatState {
  messages: ChatMessage[];
  tasks?: Task[];
}

export interface Task {
  id: string;
  title: string;
  description: string;
  category: 'coding' | 'logic' | 'formatting' | 'clarity' | 'other';
  errorExamples: string[]; // Příklady chyb na kterých se má naučit
  weight: number; // Důležitost (1-10)
  lastChecked?: number;
}

export interface Conscience extends MiniModelResult {
  tasksFocused?: string[]; // Které tasky zrovna kontroloval
}

export interface GuardianResult {
  isOk: boolean;
  cleanedResponse: string;
  issues: string[];
  shouldRetry: boolean;
  loopDetected: boolean;
  repetitionScore: number;
}

export interface GuardianStats {
  totalChecks: number;
  loopsDetected: number;
  repetitionsFixed: number;
  retriesTriggered: number;
  miniModelValidations: number;
  miniModelRejections: number;
  hallucinationsDetected: number;
  similarResponsesBlocked: number;
}

export interface HallucinationResult {
  isHallucination: boolean;
  confidence: number; // 0-1
  reasons: string[];
  category: 'factual' | 'contextual' | 'self-reference' | 'none';
}

export interface ResponseHistoryEntry {
  response: string;
  timestamp: number;
  promptHash: string;
  score: number;
}

export interface QualityCheckResult {
  name: string;
  ok: boolean;
  score?: number;
  rawScore?: number;
  threshold?: number;
  details?: string;
  unavailable?: boolean;
}

export interface MiniModelResult {
  isValid: boolean;
  score: number;        // 1-10
  reason: string;
  shouldRetry: boolean;
  unavailable?: boolean;
  errorCode?: string;
}

export type ExecutionMode = 'chat' | 'editor' | 'hybrid';
export type ValidationPolicy = 'fail-soft' | 'fail-closed';

export interface AutoApprovePolicy {
  read: boolean;
  edit: boolean;
  commands: boolean;
  browser: boolean;
  mcp: boolean;
}

export type ContextProviderName = 'workspace' | 'file' | 'code' | 'diff' | 'terminal' | 'docs' | 'web';

export type StepType = 
  | 'analyze'      // Analyzovat požadavek
  | 'install'      // Nainstalovat závislosti
  | 'code'         // Napsat/upravit kód
  | 'compile'      // Zkompilovat
  | 'test'         // Otestovat
  | 'explain'      // Vysvětlit
  | 'refactor'     // Refaktorovat
  | 'debug'        // Debugovat
  | 'document'     // Dokumentovat
  | 'review'       // Zkontrolovat
  | 'other';       // Ostatní

export interface ActionStep {
  id: number;
  type: StepType;
  title: string;           // Krátký název kroku
  instruction: string;     // Detailní instrukce pro hlavní model
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: string;         // Výsledek kroku
  dependencies?: number[]; // ID kroků, které musí být dokončeny před tímto
}

export interface RozumPlan {
  shouldPlan: boolean;        // Zda prompt vyžaduje plánování
  complexity: 'simple' | 'medium' | 'complex';
  steps: ActionStep[];        // Akční kroky pro provedení
  warnings: string[];         // Varování pro hlavní model
  suggestedApproach: string;  // Doporučený přístup
  estimatedLength: 'short' | 'medium' | 'long';
  totalSteps: number;
}

// Webview message types
export interface WebviewMessage {
  type: string;
  [key: string]: unknown;
}

export interface ChatWebviewMessage extends WebviewMessage {
  type: 'chat';
  prompt: string;
}

export interface DebugLogMessage extends WebviewMessage {
  type: 'debugLog';
  text: string;
}

// Wrapper interface for both Panel and View
export interface WebviewWrapper {
  webview: {
    postMessage(message: unknown): Thenable<boolean>;
  };
  visible: boolean;
}
