import { expect } from 'chai';
import { TurnOrchestrator, PipelineNode, TurnCheckpoint } from '../src/orchestration';

describe('TurnOrchestrator', () => {
  it('starts at plan with one checkpoint', () => {
    const o = new TurnOrchestrator();
    expect(o.getCurrent()).to.equal('plan');
    const cp = o.getCheckpoints();
    expect(cp).to.have.length(1);
    expect(cp[0].node).to.equal('plan');
    expect(cp[0].at).to.be.a('number');
  });

  it('stores initialMeta in the first checkpoint', () => {
    const o = new TurnOrchestrator({ reason: 'boot' });
    const cp = o.getCheckpoints();
    expect(cp[0].meta).to.deep.equal({ reason: 'boot' });
  });

  // --- canTransition ---
  describe('canTransition', () => {
    it('plan -> act is valid', () => {
      expect(new TurnOrchestrator().canTransition('act')).to.be.true;
    });
    it('plan -> error is valid', () => {
      expect(new TurnOrchestrator().canTransition('error')).to.be.true;
    });
    it('plan -> verify is invalid', () => {
      expect(new TurnOrchestrator().canTransition('verify')).to.be.false;
    });
    it('plan -> publish is invalid', () => {
      expect(new TurnOrchestrator().canTransition('publish')).to.be.false;
    });
    it('plan -> plan is invalid', () => {
      expect(new TurnOrchestrator().canTransition('plan')).to.be.false;
    });
  });

  // --- transition ---
  describe('transition', () => {
    it('valid transitions return true and update current', () => {
      const o = new TurnOrchestrator();
      expect(o.transition('act')).to.be.true;
      expect(o.getCurrent()).to.equal('act');
      expect(o.transition('verify')).to.be.true;
      expect(o.getCurrent()).to.equal('verify');
      expect(o.transition('publish')).to.be.true;
      expect(o.getCurrent()).to.equal('publish');
    });

    it('invalid transition returns false and keeps current', () => {
      const o = new TurnOrchestrator();
      expect(o.transition('publish')).to.be.false;
      expect(o.getCurrent()).to.equal('plan');
    });

    it('transition to error from any active state', () => {
      for (const startState of ['plan', 'act', 'verify'] as PipelineNode[]) {
        const o = new TurnOrchestrator();
        // Drive to startState
        if (startState === 'act') o.transition('act');
        if (startState === 'verify') { o.transition('act'); o.transition('verify'); }
        expect(o.transition('error')).to.be.true;
        expect(o.getCurrent()).to.equal('error');
      }
    });

    it('publish is terminal — no transitions allowed', () => {
      const o = new TurnOrchestrator();
      o.transition('act');
      o.transition('verify');
      o.transition('publish');
      expect(o.transition('plan')).to.be.false;
      expect(o.transition('error')).to.be.false;
      expect(o.getCurrent()).to.equal('publish');
    });

    it('error is terminal — no transitions allowed', () => {
      const o = new TurnOrchestrator();
      o.transition('error');
      expect(o.transition('plan')).to.be.false;
      expect(o.transition('act')).to.be.false;
      expect(o.getCurrent()).to.equal('error');
    });

    it('records meta in checkpoint on transition', () => {
      const o = new TurnOrchestrator();
      o.transition('act', { tool: 'write_file' });
      const cp = o.getCheckpoints();
      expect(cp[1].node).to.equal('act');
      expect(cp[1].meta).to.deep.equal({ tool: 'write_file' });
    });
  });

  // --- force ---
  describe('force', () => {
    it('bypasses validation from plan to publish', () => {
      const o = new TurnOrchestrator();
      o.force('publish', { reason: 'skip' });
      expect(o.getCurrent()).to.equal('publish');
      const cp = o.getCheckpoints();
      expect(cp[1].node).to.equal('publish');
      expect(cp[1].meta).to.deep.equal({ reason: 'skip' });
    });

    it('can force from terminal error to plan', () => {
      const o = new TurnOrchestrator();
      o.transition('error');
      o.force('plan');
      expect(o.getCurrent()).to.equal('plan');
      expect(o.getCheckpoints()).to.have.length(3);
    });
  });

  // --- getCheckpoints ---
  describe('getCheckpoints', () => {
    it('returns a copy (does not expose internal array)', () => {
      const o = new TurnOrchestrator();
      const a = o.getCheckpoints();
      const b = o.getCheckpoints();
      expect(a).to.not.equal(b);
      expect(a).to.deep.equal(b);
    });

    it('records full path through states', () => {
      const o = new TurnOrchestrator({ step: 0 });
      o.transition('act', { step: 1 });
      o.transition('verify', { step: 2 });
      o.transition('publish', { step: 3 });
      const cp = o.getCheckpoints();
      expect(cp.map(c => c.node)).to.deep.equal(['plan', 'act', 'verify', 'publish']);
      expect(cp.map(c => (c.meta as any).step)).to.deep.equal([0, 1, 2, 3]);
    });

    it('checkpoint timestamps are monotonically non-decreasing', () => {
      const o = new TurnOrchestrator();
      o.transition('act');
      o.transition('verify');
      const cp = o.getCheckpoints();
      for (let i = 1; i < cp.length; i++) {
        expect(cp[i].at).to.be.at.least(cp[i - 1].at);
      }
    });

    it('should cap checkpoints at 500 to prevent memory leaks', () => {
      const o = new TurnOrchestrator();
      // force() bypasses transition rules, so we can push many checkpoints
      for (let i = 0; i < 600; i++) {
        o.force('error', { i });
      }
      const cp = o.getCheckpoints();
      expect(cp.length).to.be.at.most(500);
      // Last checkpoint should be the most recent
      expect(cp[cp.length - 1].meta).to.deep.equal({ i: 599 });
    });

    it('should truncate oversized meta to prevent memory leaks', () => {
      const o = new TurnOrchestrator();
      const hugeMeta = { data: 'x'.repeat(20000) };
      o.force('act', hugeMeta);
      const cp = o.getCheckpoints();
      const lastMeta = cp[cp.length - 1].meta as any;
      expect(lastMeta._truncated).to.be.true;
      expect(lastMeta._originalSize).to.be.a('number');
      expect(lastMeta._originalSize).to.be.greaterThan(10000);
    });

    it('should handle unserializable meta gracefully', () => {
      const o = new TurnOrchestrator();
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;
      o.force('act', circular);
      const cp = o.getCheckpoints();
      const lastMeta = cp[cp.length - 1].meta as any;
      expect(lastMeta._error).to.equal('unserializable');
    });
  });
});
