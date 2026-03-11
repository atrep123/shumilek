# Longest Testing Report

- Date: 2026-03-01
- Scope: 3x long runs (`node-project-api-large`, `maxIterations=12`, `timeoutSec=1800`)
- Baseline tests: `npm test` passed (159 passing)

| Run ID | OK | Parse Failures | EADDRINUSE Mentions | Oracle Exit |
|---|---:|---:|---:|---:|
| 1772311961999 | False | 1 | 10 | 1 |
| 1772319600681 | False | 3 | 10 | 1 |
| 1772325886622 | False | 1 | 10 | 1 |

- Avg parseFailures: 1.67
- Dominant failure cluster: `node --test tests/oracle.test.js` with repeated `EADDRINUSE` transport failures.
- Conclusion: Long-run stability is currently blocked mainly by runtime transport/port behavior, not by compile/test regressions.
