# Nightly Calibration Recommendation

Generated: 2026-03-06T01:06:21.798Z
Window: 10
Baseline: C:\actions-runner\release_gate_stable_longrunC_20260224_075013

## Scenario latency recommendation

| Scenario | p95(avgMs ratio) | Recommended multiplier (p95 * 1.15, round-up 0.01) | Samples |
|---|---:|---:|---:|
| node-api-oracle | 0.9973 | 1.15 | 2 |
| python-ai-stdlib-oracle | 1.0224 | 1.18 | 2 |
| ts-todo-oracle | 1.0087 | 1.16 | 2 |

## Readiness

- ready_to_tighten_pr: false
- reason_if_not_ready: release_gate_ci_nightly_22739312889_1: nightly run is missing required completion artifacts
- last3NightlyRunIds: 22742147951, 22740585852, 22739312889

## Inputs
- C:\actions-runner\bot_eval_run\release_gate_ci_nightly_22742147951_1
- C:\actions-runner\bot_eval_run\release_gate_ci_nightly_22740585852_1
