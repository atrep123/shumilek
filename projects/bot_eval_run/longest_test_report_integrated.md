# Integrated Long Test Report

- Date: 2026-03-01
- Scope: 3x long runs after integration hardening (`maxIterations=10`, `timeoutSec=1800`)
- Baseline comparison: previous 3x long runs (`maxIterations=12`)

| Metric | Previous | Integrated | Delta |
|---|---:|---:|---:|
| Pass count | 0/3 | 0/3 | 0 |
| Total EADDRINUSE mentions | 30 | 8 | -22 |
| Avg parseFailures | 1.67 | 1 | -0.67 |

## Integrated run details
| Run ID | Duration (s) | OK | Parse Failures | EADDRINUSE | Primary diagnostics |
|---|---:|---:|---:|---:|---|
| run_1772352156769 | 6960 | False | 1 | 0 | Command failed: node --test tests/oracle.test.js (exit=1, timedOut=false) |
| run_1772359117068 | 6350 | False | 1 | 8 | Command failed: node --test tests/oracle.test.js (exit=1, timedOut=false) / Runtime transport error (EADDRINUSE): avoid auto-listening on fixed ports and export app-only contract for supertest. |
| run_1772365466907 | 3476 | False | 1 | 0 | Command failed: node --test tests/oracle.test.js (exit=1, timedOut=false) / App contract failed: export app as module.exports = app / exports.app / default export in src/app.* |

## Conclusion
- Integration reduced EADDRINUSE frequency significantly (30 -> 8), but pass-rate remains 0/3.
- Current dominant blockers are mixed runtime issues: ETIMEDOUT/EADDRINUSE in some runs and syntax/app export breakage in others.
- Next hardening should target generated app syntax validity and supertest transport stability.
