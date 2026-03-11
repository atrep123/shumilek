# Nightly Calibration Recommendation

Generated: 2026-03-05T23:04:20.895Z
Window: 10
Baseline: C:\actions-runner\release_gate_stable_longrunC_20260224_075013

## Scenario latency recommendation

| Scenario | p95(avgMs ratio) | Recommended multiplier (p95 * 1.15, round-up 0.01) | Samples |
|---|---:|---:|---:|
| node-api-oracle | 1.0036 | 1.16 | 1 |
| python-ai-stdlib-oracle | 1.0226 | 1.18 | 1 |
| ts-todo-oracle | 0.8956 | 1.03 | 1 |

## Readiness

- ready_to_tighten_pr: false
- reason_if_not_ready: Need at least 3 nightly runs for readiness, found 1.
- last3NightlyRunIds: 22739312889

## Inputs
- C:\actions-runner\bot_eval_run\release_gate_ci_nightly_22739312889_1
