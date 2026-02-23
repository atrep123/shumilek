export type PipelineNode = 'plan' | 'act' | 'verify' | 'publish' | 'error';

export interface TurnCheckpoint {
  node: PipelineNode;
  at: number;
  meta?: Record<string, unknown>;
}

const VALID_TRANSITIONS: Record<PipelineNode, PipelineNode[]> = {
  plan: ['act', 'error'],
  act: ['verify', 'error'],
  verify: ['publish', 'error'],
  publish: [],
  error: []
};

export class TurnOrchestrator {
  private current: PipelineNode = 'plan';
  private readonly checkpoints: TurnCheckpoint[] = [];

  constructor(initialMeta?: Record<string, unknown>) {
    this.checkpoint('plan', initialMeta);
  }

  canTransition(next: PipelineNode): boolean {
    return VALID_TRANSITIONS[this.current].includes(next);
  }

  transition(next: PipelineNode, meta?: Record<string, unknown>): boolean {
    if (!this.canTransition(next)) return false;
    this.current = next;
    this.checkpoint(next, meta);
    return true;
  }

  force(next: PipelineNode, meta?: Record<string, unknown>): void {
    this.current = next;
    this.checkpoint(next, meta);
  }

  getCurrent(): PipelineNode {
    return this.current;
  }

  getCheckpoints(): TurnCheckpoint[] {
    return this.checkpoints.slice();
  }

  private checkpoint(node: PipelineNode, meta?: Record<string, unknown>): void {
    this.checkpoints.push({ node, at: Date.now(), meta });
  }
}

