# Large Hybrid Stabilization Checkpoint (2026-03-05)

Scenario: `node-project-api-large`

## Outcome
- Result: **PASS**
- 32b after-fix: **11/11 pass (100%)** across three batches
- 14b after-fix: **5/5 pass (100%)**
- Fallback dependency run-rate: **0%**

## Before vs After (32b)
| Batch | Pass | PassRate | RawRunPassRate | FallbackRunRate | AvgSec | Clusters |
|---|---:|---:|---:|---:|---:|---|
| batch_large_hybrid_32b_v3_autorestart_20260305 | 0/3 | 0% | 0% | 0% | 900.08 | other:6, timeout:3 |
| batch_large_hybrid_32b_v4_timeout600_20260305 | 0/1 | 0% | 0% | 0% | 660.03 | other:2, timeout:1 |
| batch_1772711932665 | 3/3 | 100% | 100% | 0% | 456.12 | n/a |
| batch_1772713371210 | 3/3 | 100% | 100% | 0% | 460.46 | n/a |
| batch_1772717548021 | 5/5 | 100% | 100% | 0% | 462.81 | n/a |

## 14b Confirmation
| Batch | Pass | PassRate | RawRunPassRate | FallbackRunRate | AvgSec |
|---|---:|---:|---:|---:|---:|
| batch_1772714794192 | 5/5 | 100% | 100% | 0% | 537.67 |

## Recommended Next Step
1. Commit stabilization changes in `scripts/botEval.ts` + tests.
2. Open PR as "large-scenario stabilization checkpoint" with this report as evidence.
3. Keep scenario manual-only for now; do not gate nightly yet.
