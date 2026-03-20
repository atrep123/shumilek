const mock = require('mock-require');
mock('vscode', {});

const { expect } = require('chai');
const { ModelRouter } = require('../src/modelRouter');

describe('ModelRouter', () => {
  describe('constructor', () => {
    it('should initialize with given models', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a', 'model-b', 'model-c'],
      });
      const report = router.getHealthReport();
      expect(report).to.have.length(3);
      expect(report[0].model).to.equal('model-a');
      expect(report[1].model).to.equal('model-b');
      expect(report[2].model).to.equal('model-c');
    });

    it('should start with zero stats', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a'],
      });
      const report = router.getHealthReport();
      expect(report[0].totalCalls).to.equal(0);
      expect(report[0].successCalls).to.equal(0);
      expect(report[0].consecutiveFailures).to.equal(0);
    });
  });

  describe('pick', () => {
    it('should return first model when all healthy', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a', 'model-b'],
      });
      expect(router.pick()).to.equal('model-a');
    });

    it('should skip backed-off model', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a', 'model-b'],
        maxConsecutiveFailures: 2,
        backoffMs: 60000,
      });
      // Fail model-a enough to trigger backoff
      router.recordFailure('model-a', 'err');
      router.recordFailure('model-a', 'err');
      expect(router.pick()).to.equal('model-b');
    });

    it('should return soonest-resuming model when all backed off', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a', 'model-b'],
        maxConsecutiveFailures: 1,
        backoffMs: 60000,
      });
      router.recordFailure('model-a', 'err');
      router.recordFailure('model-b', 'err');
      // model-a was backed off first, so it resumes first
      const pick = router.pick();
      expect(pick).to.equal('model-a');
    });
  });

  describe('recordSuccess', () => {
    it('should increment counters', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a'],
      });
      router.recordSuccess('model-a', 100);
      const report = router.getHealthReport();
      expect(report[0].totalCalls).to.equal(1);
      expect(report[0].successCalls).to.equal(1);
      expect(report[0].avgLatencyMs).to.equal(100);
    });

    it('should clear consecutive failures', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a'],
        maxConsecutiveFailures: 5,
      });
      router.recordFailure('model-a', 'err');
      router.recordFailure('model-a', 'err');
      router.recordSuccess('model-a', 100);
      const report = router.getHealthReport();
      expect(report[0].consecutiveFailures).to.equal(0);
    });

    it('should compute rolling average latency', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a'],
      });
      router.recordSuccess('model-a', 100);
      router.recordSuccess('model-a', 200);
      const report = router.getHealthReport();
      // First call: 100, second: 100*0.8 + 200*0.2 = 120
      expect(report[0].avgLatencyMs).to.equal(120);
    });

    it('should clear backoff on success', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a', 'model-b'],
        maxConsecutiveFailures: 1,
        backoffMs: 60000,
      });
      router.recordFailure('model-a', 'err');
      expect(router.isBackedOff('model-a')).to.be.true;
      router.recordSuccess('model-a', 100);
      expect(router.isBackedOff('model-a')).to.be.false;
    });

    it('should ignore unknown model', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a'],
      });
      router.recordSuccess('unknown-model', 100);
      const report = router.getHealthReport();
      expect(report[0].totalCalls).to.equal(0);
    });
  });

  describe('recordFailure', () => {
    it('should increment failure counters', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a'],
      });
      router.recordFailure('model-a', 'timeout');
      const report = router.getHealthReport();
      expect(report[0].totalCalls).to.equal(1);
      expect(report[0].consecutiveFailures).to.equal(1);
      expect(report[0].lastError).to.equal('timeout');
      expect(report[0].lastErrorAt).to.be.a('number');
    });

    it('should trigger backoff after max failures', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a'],
        maxConsecutiveFailures: 3,
        backoffMs: 60000,
      });
      router.recordFailure('model-a', 'err');
      router.recordFailure('model-a', 'err');
      expect(router.isBackedOff('model-a')).to.be.false;
      router.recordFailure('model-a', 'err');
      expect(router.isBackedOff('model-a')).to.be.true;
    });

    it('should not backoff below threshold', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a'],
        maxConsecutiveFailures: 3,
      });
      router.recordFailure('model-a', 'err');
      router.recordFailure('model-a', 'err');
      expect(router.isBackedOff('model-a')).to.be.false;
    });
  });

  describe('isBackedOff', () => {
    it('should return false for healthy model', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a'],
      });
      expect(router.isBackedOff('model-a')).to.be.false;
    });

    it('should return false for unknown model', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a'],
      });
      expect(router.isBackedOff('nonexistent')).to.be.false;
    });
  });

  describe('reset', () => {
    it('should clear all stats and backoffs', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a', 'model-b'],
        maxConsecutiveFailures: 1,
      });
      router.recordSuccess('model-a', 500);
      router.recordFailure('model-b', 'err');
      router.reset();
      const report = router.getHealthReport();
      for (const h of report) {
        expect(h.totalCalls).to.equal(0);
        expect(h.successCalls).to.equal(0);
        expect(h.consecutiveFailures).to.equal(0);
        expect(h.avgLatencyMs).to.equal(0);
        expect(h.lastError).to.be.undefined;
      }
      expect(router.isBackedOff('model-b')).to.be.false;
    });
  });

  describe('updateModels', () => {
    it('should add new models', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a'],
      });
      router.updateModels(['model-a', 'model-b']);
      const report = router.getHealthReport();
      expect(report).to.have.length(2);
    });

    it('should keep existing stats', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a'],
      });
      router.recordSuccess('model-a', 100);
      router.updateModels(['model-a', 'model-b']);
      const report = router.getHealthReport();
      expect(report[0].successCalls).to.equal(1);
      expect(report[1].successCalls).to.equal(0);
    });

    it('should remove stale models from health and backoff maps', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a', 'model-b', 'model-c'],
        maxConsecutiveFailures: 1,
        backoffMs: 60000,
      });
      router.recordSuccess('model-a', 100);
      router.recordFailure('model-b', 'down');
      // model-b is now backed off
      expect(router.isBackedOff('model-b')).to.be.true;

      // Remove model-b and model-c, add model-d
      router.updateModels(['model-a', 'model-d']);
      const report = router.getHealthReport();
      const names = report.map(h => h.model);
      expect(names).to.deep.equal(['model-a', 'model-d']);
      expect(names).to.not.include('model-b');
      expect(names).to.not.include('model-c');
      // Backoff for removed model should also be gone
      expect(router.isBackedOff('model-b')).to.be.false;
    });
  });

  describe('getHealthReport', () => {
    it('should return copies, not originals', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a'],
      });
      const report1 = router.getHealthReport();
      report1[0].totalCalls = 999;
      const report2 = router.getHealthReport();
      expect(report2[0].totalCalls).to.equal(0);
    });
  });

  describe('failover integration', () => {
    it('should fail over through all models', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a', 'model-b', 'model-c'],
        maxConsecutiveFailures: 2,
        backoffMs: 60000,
      });
      // Fail model-a
      router.recordFailure('model-a', 'down');
      router.recordFailure('model-a', 'down');
      expect(router.pick()).to.equal('model-b');

      // Fail model-b
      router.recordFailure('model-b', 'down');
      router.recordFailure('model-b', 'down');
      expect(router.pick()).to.equal('model-c');

      // Fail model-c — should pick soonest to resume
      router.recordFailure('model-c', 'down');
      router.recordFailure('model-c', 'down');
      const pick = router.pick();
      expect(['model-a', 'model-b', 'model-c']).to.include(pick);
    });

    it('should recover model after successful call', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a', 'model-b'],
        maxConsecutiveFailures: 2,
        backoffMs: 60000,
      });
      router.recordFailure('model-a', 'down');
      router.recordFailure('model-a', 'down');
      expect(router.pick()).to.equal('model-b');

      // model-a recovers
      router.recordSuccess('model-a', 100);
      expect(router.pick()).to.equal('model-a');
    });
  });

  describe('edge cases', () => {
    it('should throw when models array is empty', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: [],
      });
      expect(() => router.pick()).to.throw('no models configured');
    });

    it('should guard NaN latency in recordSuccess', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a'],
      });
      router.recordSuccess('model-a', NaN);
      const report = router.getHealthReport();
      expect(Number.isFinite(report[0].avgLatencyMs)).to.be.true;
    });

    it('should guard Infinity latency in recordSuccess', () => {
      const router = new ModelRouter({
        baseUrl: 'http://localhost:11434',
        models: ['model-a'],
      });
      router.recordSuccess('model-a', Infinity);
      router.recordSuccess('model-a', 200);
      const report = router.getHealthReport();
      expect(Number.isFinite(report[0].avgLatencyMs)).to.be.true;
    });
  });
});
