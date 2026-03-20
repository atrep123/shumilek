/**
 * Model Router — Intelligent model failover with health tracking.
 *
 * Inspired by OpenClaw's model failover chain.
 * Tracks per-model health scores and automatically fails over to smaller models
 * when the primary is unresponsive or slow.
 */

import fetch from 'node-fetch';

export interface ModelHealth {
  model: string;
  /** Calls in the last window */
  totalCalls: number;
  /** Successful calls */
  successCalls: number;
  /** Average latency in ms for successful calls */
  avgLatencyMs: number;
  /** Last error message */
  lastError?: string;
  /** When the last error occurred */
  lastErrorAt?: number;
  /** Consecutive failures */
  consecutiveFailures: number;
}

export interface ModelRouterConfig {
  baseUrl: string;
  /** Ordered from most preferred to least */
  models: string[];
  /** Max consecutive failures before demotion (default: 3) */
  maxConsecutiveFailures: number;
  /** Backoff time after demotion in ms (default: 60000) */
  backoffMs: number;
  /** Health check timeout in ms (default: 5000) */
  healthCheckTimeoutMs: number;
}

const DEFAULT_CONFIG: Omit<ModelRouterConfig, 'baseUrl' | 'models'> = {
  maxConsecutiveFailures: 3,
  backoffMs: 60_000,
  healthCheckTimeoutMs: 5000
};

export class ModelRouter {
  private config: ModelRouterConfig;
  private health: Map<string, ModelHealth> = new Map();
  /** Models that are currently backed off (demoted), keyed by model name → resume timestamp */
  private backoff: Map<string, number> = new Map();

  constructor(config: Partial<ModelRouterConfig> & Pick<ModelRouterConfig, 'baseUrl' | 'models'>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    for (const model of this.config.models) {
      this.health.set(model, {
        model,
        totalCalls: 0,
        successCalls: 0,
        avgLatencyMs: 0,
        consecutiveFailures: 0
      });
    }
  }

  /**
   * Pick the best available model.
   * Returns the highest-priority model that is not backed off.
   * If all are backed off, returns the one with the soonest resume time.
   */
  pick(): string {
    if (this.config.models.length === 0) {
      throw new Error('ModelRouter: no models configured');
    }
    const now = Date.now();
    for (const model of this.config.models) {
      const resumeAt = this.backoff.get(model);
      if (!resumeAt || now >= resumeAt) {
        // Clear expired backoff
        if (resumeAt) this.backoff.delete(model);
        return model;
      }
    }
    // All backed off — pick the one closest to resuming
    let bestModel = this.config.models[0];
    let bestResume = Infinity;
    for (const model of this.config.models) {
      const resume = this.backoff.get(model) ?? Infinity;
      if (resume < bestResume) {
        bestResume = resume;
        bestModel = model;
      }
    }
    return bestModel;
  }

  /**
   * Record a successful call for a model.
   */
  recordSuccess(model: string, latencyMs: number): void {
    const h = this.health.get(model);
    if (!h) return;
    if (!Number.isFinite(latencyMs) || latencyMs < 0) latencyMs = 0;
    h.totalCalls++;
    h.successCalls++;
    h.consecutiveFailures = 0;
    // Rolling average
    h.avgLatencyMs = h.successCalls === 1
      ? latencyMs
      : h.avgLatencyMs * 0.8 + latencyMs * 0.2;
    // Clear backoff on success
    this.backoff.delete(model);
  }

  /**
   * Record a failed call for a model.
   */
  recordFailure(model: string, error: string): void {
    const h = this.health.get(model);
    if (!h) return;
    h.totalCalls++;
    h.consecutiveFailures++;
    h.lastError = error;
    h.lastErrorAt = Date.now();
    // Demote if too many consecutive failures
    if (h.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      this.backoff.set(model, Date.now() + this.config.backoffMs);
    }
  }

  /**
   * Get health status for all models.
   */
  getHealthReport(): ModelHealth[] {
    return this.config.models.map(m => {
      const h = this.health.get(m)!;
      return { ...h };
    });
  }

  /**
   * Check if a specific model is currently backed off.
   */
  isBackedOff(model: string): boolean {
    const resume = this.backoff.get(model);
    if (!resume) return false;
    if (Date.now() >= resume) {
      this.backoff.delete(model);
      return false;
    }
    return true;
  }

  /**
   * Reset all health data and backoffs.
   */
  reset(): void {
    for (const [, h] of this.health) {
      h.totalCalls = 0;
      h.successCalls = 0;
      h.avgLatencyMs = 0;
      h.consecutiveFailures = 0;
      h.lastError = undefined;
      h.lastErrorAt = undefined;
    }
    this.backoff.clear();
  }

  /**
   * Update the model list (e.g. from config change).
   */
  updateModels(models: string[]): void {
    this.config.models = models;
    // Add health entries for new models
    for (const model of models) {
      if (!this.health.has(model)) {
        this.health.set(model, {
          model,
          totalCalls: 0,
          successCalls: 0,
          avgLatencyMs: 0,
          consecutiveFailures: 0
        });
      }
    }
  }

  /**
   * Quick Ollama health check for a model.
   */
  async checkModelHealth(model: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.healthCheckTimeoutMs);
      const res = await fetch(`${this.config.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model }),
        signal: controller.signal
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }
}
