export class ChatRequestConcurrencyGuard {
  private topLevelInFlight = false;

  // Retries (retryCount > 0) are allowed while the original request is active.
  tryAcquire(retryCount: number): boolean {
    if (retryCount > 0) return true;
    if (this.topLevelInFlight) return false;
    this.topLevelInFlight = true;
    return true;
  }

  release(retryCount: number): void {
    if (retryCount > 0) return;
    this.topLevelInFlight = false;
  }

  isTopLevelInFlight(): boolean {
    return this.topLevelInFlight;
  }
}
