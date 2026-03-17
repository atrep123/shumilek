import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  evaluateQualification,
  runBaselinePromotion
} from '../scripts/botEvalBaselinePromote';

function writeJson(filePath: string, value: any): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function createSummaryRow(overrides: Partial<any> = {}): any {
  return {
    scenario: 'ts-todo-oracle',
    passRate: 1,
    rawRunPassRate: 1,
    fallbackDependencyRunRate: 0,
    total: 5,
    runsWithPlannerError: 0,
    runsWithJsonRepairError: 0,
    runsWithSchemaFailure: 0,
    runsWithJsonParseFailure: 0,
    runsWithPlaceholderFailure: 0,
    runsWithOtherParseFailure: 0,
    ...overrides
  };
}

function defaultOptions(tmp: string, overrides: Partial<Parameters<typeof runBaselinePromotion>[0]> = {}) {
  return {
    candidateDir: path.join(tmp, 'candidate'),
    stableDir: path.join(tmp, 'stable'),
    statePath: path.join(tmp, 'state', 'baseline_promotion_state.json'),
    outPath: path.join(tmp, 'out', 'baseline_promotion.json'),
    scenario: 'ts-todo-oracle',
    requiredConsecutive: 2,
    minRawRunPassRate: 1,
    maxFallbackDependencyRunRate: 0,
    maxPlannerErrorRate: 0.15,
    ...overrides
  };
}

describe('botEvalBaselinePromote', () => {
  it('rejects qualification when planner error rate or parse failures exceed guards', () => {
    const qualification = evaluateQualification(defaultOptions('C:\\tmp') as any, [
      createSummaryRow({ runsWithPlannerError: 1, total: 4 }),
      createSummaryRow({
        scenario: 'node-api-oracle',
        runsWithJsonRepairError: 1,
        total: 5
      })
    ]);

    assert.equal(qualification.ok, false);
    assert.match(qualification.reason, /planner error rate/i);
    assert.match(qualification.reason, /json repair errors/i);
  });

  it('promotes after reaching the required streak and persists state and report', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-baseline-promote-'));
    try {
      const opts = defaultOptions(tmp);
      writeJson(path.join(opts.candidateDir, 'summary.json'), [createSummaryRow()]);
      writeJson(path.join(opts.candidateDir, 'results.json'), { ok: true });
      writeJson(opts.statePath, {
        version: 1,
        requiredConsecutive: 2,
        streak: 1,
        history: []
      });

      const report = await runBaselinePromotion(opts);

      assert.equal(report.qualified, true);
      assert.equal(report.promoted, true);
      assert.match(report.promotionMessage, /promoted after streak 2\/2/i);
      assert.ok(fs.existsSync(path.join(opts.stableDir, 'results.json')));

      const state = JSON.parse(fs.readFileSync(opts.statePath, 'utf8'));
      assert.equal(state.streak, 2);
      assert.equal(state.lastPromotion.candidateDir, opts.candidateDir);
      assert.equal(state.history.at(-1).promoted, true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('resets streak on unqualified candidate even when prior state was green', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-baseline-promote-'));
    try {
      const opts = defaultOptions(tmp);
      writeJson(path.join(opts.candidateDir, 'summary.json'), [createSummaryRow({ rawRunPassRate: 0.8 })]);
      writeJson(opts.statePath, {
        version: 1,
        requiredConsecutive: 2,
        streak: 3,
        history: []
      });

      const report = await runBaselinePromotion(opts);
      const state = JSON.parse(fs.readFileSync(opts.statePath, 'utf8'));

      assert.equal(report.qualified, false);
      assert.equal(report.promoted, false);
      assert.equal(report.streakAfter, 0);
      assert.equal(state.streak, 0);
      assert.match(report.promotionMessage, /not qualified/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('recovers from invalid state file and skips copy when candidate equals stable dir', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-baseline-promote-'));
    try {
      const candidateDir = path.join(tmp, 'shared');
      const opts = defaultOptions(tmp, {
        candidateDir,
        stableDir: candidateDir,
        requiredConsecutive: 1
      });
      fs.mkdirSync(path.dirname(opts.statePath), { recursive: true });
      fs.writeFileSync(opts.statePath, '{broken json', 'utf8');
      writeJson(path.join(candidateDir, 'summary.json'), [createSummaryRow()]);
      writeJson(path.join(candidateDir, 'results.json'), { ok: true });

      const report = await runBaselinePromotion(opts);
      const state = JSON.parse(fs.readFileSync(opts.statePath, 'utf8'));

      assert.equal(report.qualified, true);
      assert.equal(report.promoted, false);
      assert.match(report.promotionMessage, /skip copy/i);
      assert.equal(state.streak, 1);
      assert.equal(state.history.length, 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails with a clear error when promoted copy does not contain results.json', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-baseline-promote-'));
    try {
      const opts = defaultOptions(tmp, { requiredConsecutive: 1 });
      writeJson(path.join(opts.candidateDir, 'summary.json'), [createSummaryRow()]);

      await assert.rejects(
        () => runBaselinePromotion(opts),
        /missing results\.json/i
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});