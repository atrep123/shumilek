const { expect } = require('chai');
const { ChatRequestConcurrencyGuard } = require('../src/chatConcurrency');

describe('ChatRequestConcurrencyGuard', () => {
  it('allows first top-level request and blocks concurrent top-level request', () => {
    const guard = new ChatRequestConcurrencyGuard();

    expect(guard.tryAcquire(0)).to.equal(true);
    expect(guard.isTopLevelInFlight()).to.equal(true);
    expect(guard.tryAcquire(0)).to.equal(false);
  });

  it('allows retry while top-level request is active', () => {
    const guard = new ChatRequestConcurrencyGuard();

    expect(guard.tryAcquire(0)).to.equal(true);
    expect(guard.tryAcquire(1)).to.equal(true);
    expect(guard.tryAcquire(2)).to.equal(true);
    expect(guard.isTopLevelInFlight()).to.equal(true);
  });

  it('releases lock only on top-level release', () => {
    const guard = new ChatRequestConcurrencyGuard();

    expect(guard.tryAcquire(0)).to.equal(true);
    guard.release(1);
    expect(guard.isTopLevelInFlight()).to.equal(true);

    guard.release(0);
    expect(guard.isTopLevelInFlight()).to.equal(false);
    expect(guard.tryAcquire(0)).to.equal(true);
  });
});
