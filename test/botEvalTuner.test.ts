import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  buildTuningDecision,
  runTuner,
  updateTunerState
} from '../scripts/botEvalTuner';

function writeJson(filePath: string, value: any): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

describe('botEvalTuner', () => {
  it('accepts a qualified checkpoint when calibration is ready', () => {
    const decision = buildTuningDecision({
      checkpointReport: {
        generatedAt: '2026-03-14T10:00:00.000Z',
        manifestVersion: 1,
        manifestPath: 'manifest.json',
        rootDir: 'root',
        window: 10,
        inputs: [],
        baselineDir: 'baseline',
        checkpoint: {
          qualified: true,
          reasons: [],
          latestRunDir: 'C:\\runs\\release_gate_ci_nightly_2001_1',
          latestQualifiedScenarioIds: ['node-api-oracle']
        }
      },
      calibration: {
        readiness: {
          ready_to_tighten_pr: true,
          reason_if_not_ready: ''
        }
      },
      baselinePromotion: {
        qualified: true,
        promoted: false,
        promotionMessage: 'qualified but streak 1/2 is below threshold'
      },
      registry: {
        activeCheckpointId: 'release_gate_ci_nightly_1999_1@manifest-v1'
      },
      policy: {
        version: 1,
        requireCheckpointQualification: true,
        requireCalibrationReadiness: true,
        rollbackOnCheckpointFailure: true,
        holdWhenPromotionPending: false
      }
    });

    assert.equal(decision.action, 'accept');
    assert.equal(decision.targetCheckpointId, 'release_gate_ci_nightly_2001_1@manifest-v1');
  });

  it('holds a qualified checkpoint when calibration is not ready', () => {
    const decision = buildTuningDecision({
      checkpointReport: {
        generatedAt: '2026-03-14T10:00:00.000Z',
        manifestVersion: 1,
        manifestPath: 'manifest.json',
        rootDir: 'root',
        window: 10,
        inputs: [],
        baselineDir: 'baseline',
        checkpoint: {
          qualified: true,
          reasons: [],
          latestRunDir: 'C:\\runs\\release_gate_ci_nightly_2002_1',
          latestQualifiedScenarioIds: ['node-api-oracle']
        }
      },
      calibration: {
        readiness: {
          ready_to_tighten_pr: false,
          reason_if_not_ready: 'Need at least 3 nightly runs for readiness.'
        }
      },
      registry: {
        activeCheckpointId: 'release_gate_ci_nightly_1999_1@manifest-v1'
      },
      policy: {
        version: 1,
        requireCheckpointQualification: true,
        requireCalibrationReadiness: true,
        rollbackOnCheckpointFailure: true,
        holdWhenPromotionPending: false
      }
    });

    assert.equal(decision.action, 'hold');
    assert.match(decision.rationale.join(' | '), /calibration/i);
  });

  it('rolls back to the active checkpoint when latest checkpoint fails', () => {
    const decision = buildTuningDecision({
      checkpointReport: {
        generatedAt: '2026-03-14T10:00:00.000Z',
        manifestVersion: 1,
        manifestPath: 'manifest.json',
        rootDir: 'root',
        window: 10,
        inputs: [],
        baselineDir: 'baseline',
        checkpoint: {
          qualified: false,
          reasons: ['python-ai-stdlib-oracle: rawRunPassRate=0 below 1.'],
          latestRunDir: 'C:\\runs\\release_gate_ci_nightly_2003_1',
          latestQualifiedScenarioIds: ['node-api-oracle']
        }
      },
      registry: {
        activeCheckpointId: 'release_gate_ci_nightly_2001_1@manifest-v1'
      },
      policy: {
        version: 1,
        requireCheckpointQualification: true,
        requireCalibrationReadiness: true,
        rollbackOnCheckpointFailure: true,
        holdWhenPromotionPending: false
      }
    });

    assert.equal(decision.action, 'rollback');
    assert.equal(decision.targetCheckpointId, 'release_gate_ci_nightly_2001_1@manifest-v1');
  });

  it('persists tuner state and registry updates when applying a decision', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-tuner-'));
    try {
      const checkpointPath = path.join(tmp, 'checkpoint_report.json');
      const calibrationPath = path.join(tmp, 'calibration_recommendation.json');
      const registryPath = path.join(tmp, 'checkpoint_registry.json');
      const statePath = path.join(tmp, 'tuner_state.json');
      const outPath = path.join(tmp, 'tuning_decision.json');
      const outMdPath = path.join(tmp, 'tuning_decision.md');
      const configPath = path.join(tmp, 'botEvalTuner.json');

      writeJson(checkpointPath, {
        generatedAt: '2026-03-14T10:00:00.000Z',
        manifestVersion: 1,
        manifestPath: 'manifest.json',
        rootDir: 'root',
        window: 10,
        inputs: [],
        baselineDir: 'baseline',
        checkpoint: {
          qualified: true,
          reasons: [],
          latestRunDir: 'C:\\runs\\release_gate_ci_nightly_2004_1',
          latestQualifiedScenarioIds: ['node-api-oracle']
        }
      });
      writeJson(calibrationPath, {
        readiness: {
          ready_to_tighten_pr: true,
          reason_if_not_ready: ''
        }
      });
      writeJson(configPath, {
        version: 1,
        requireCheckpointQualification: true,
        requireCalibrationReadiness: true,
        rollbackOnCheckpointFailure: true,
        holdWhenPromotionPending: false
      });
      writeJson(registryPath, {
        version: 1,
        updatedAt: '2026-03-14T09:00:00.000Z',
        activeCheckpointId: 'release_gate_ci_nightly_2001_1@manifest-v1',
        entries: []
      });

      const decision = await runTuner({
        checkpointReportPath: checkpointPath,
        calibrationPath,
        baselinePromotionPath: undefined,
        registryPath,
        statePath,
        outJson: outPath,
        outMd: outMdPath,
        configPath,
        applyDecision: true
      });

      assert.equal(decision.action, 'accept');
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      assert.equal(state.acceptedCheckpointId, 'release_gate_ci_nightly_2004_1@manifest-v1');
      const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      assert.equal(registry.activeCheckpointId, 'release_gate_ci_nightly_2004_1@manifest-v1');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('holds when promotion is qualified but not yet promoted and holdWhenPromotionPending is enabled', () => {
    const decision = buildTuningDecision({
      checkpointReport: {
        generatedAt: '2026-03-16T10:00:00.000Z',
        manifestVersion: 1,
        manifestPath: 'manifest.json',
        rootDir: 'root',
        window: 10,
        inputs: [],
        baselineDir: 'baseline',
        checkpoint: {
          qualified: true,
          reasons: [],
          latestRunDir: 'C:\\runs\\release_gate_ci_nightly_3001_1',
          latestQualifiedScenarioIds: ['ts-todo-oracle']
        }
      },
      calibration: {
        readiness: {
          ready_to_tighten_pr: true,
          reason_if_not_ready: ''
        }
      },
      baselinePromotion: {
        qualified: true,
        promoted: false,
        promotionMessage: 'streak 1/2 — promotion pending'
      },
      registry: {
        activeCheckpointId: 'release_gate_ci_nightly_2999_1@manifest-v1'
      },
      policy: {
        version: 1,
        requireCheckpointQualification: true,
        requireCalibrationReadiness: true,
        rollbackOnCheckpointFailure: true,
        holdWhenPromotionPending: true
      }
    });

    assert.equal(decision.action, 'hold');
    assert.match(decision.rationale.join(' | '), /promotion/i);
    assert.equal(decision.targetCheckpointId, 'release_gate_ci_nightly_2999_1@manifest-v1');
  });

  it('accepts when promotion is qualified and already promoted with holdWhenPromotionPending enabled', () => {
    const decision = buildTuningDecision({
      checkpointReport: {
        generatedAt: '2026-03-16T10:00:00.000Z',
        manifestVersion: 1,
        manifestPath: 'manifest.json',
        rootDir: 'root',
        window: 10,
        inputs: [],
        baselineDir: 'baseline',
        checkpoint: {
          qualified: true,
          reasons: [],
          latestRunDir: 'C:\\runs\\release_gate_ci_nightly_3002_1',
          latestQualifiedScenarioIds: ['ts-todo-oracle']
        }
      },
      calibration: {
        readiness: {
          ready_to_tighten_pr: true,
          reason_if_not_ready: ''
        }
      },
      baselinePromotion: {
        qualified: true,
        promoted: true,
        promotionMessage: 'streak 2/2 — promoted'
      },
      registry: {
        activeCheckpointId: 'release_gate_ci_nightly_2999_1@manifest-v1'
      },
      policy: {
        version: 1,
        requireCheckpointQualification: true,
        requireCalibrationReadiness: true,
        rollbackOnCheckpointFailure: true,
        holdWhenPromotionPending: true
      }
    });

    assert.equal(decision.action, 'accept');
    assert.equal(decision.targetCheckpointId, 'release_gate_ci_nightly_3002_1@manifest-v1');
  });

  it('updates tuner state without changing accepted checkpoint on hold', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-tuner-state-'));
    try {
      const statePath = path.join(tmp, 'tuner_state.json');
      writeJson(statePath, {
        version: 1,
        updatedAt: '2026-03-14T09:00:00.000Z',
        acceptedCheckpointId: 'release_gate_ci_nightly_2001_1@manifest-v1',
        history: []
      });
      const updated = updateTunerState(statePath, {
        generatedAt: '2026-03-14T10:00:00.000Z',
        action: 'hold',
        rationale: ['waiting for calibration'],
        latestCheckpointId: 'release_gate_ci_nightly_2005_1@manifest-v1',
        activeCheckpointId: 'release_gate_ci_nightly_2001_1@manifest-v1',
        targetCheckpointId: 'release_gate_ci_nightly_2001_1@manifest-v1',
        checkpointQualified: true,
        calibrationReady: false,
        calibrationReason: 'not ready',
        baselinePromotionQualified: true,
        baselinePromoted: false,
        baselinePromotionMessage: 'pending streak'
      });

      assert.equal(updated.acceptedCheckpointId, 'release_gate_ci_nightly_2001_1@manifest-v1');
      assert.equal(updated.lastDecision.action, 'hold');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});