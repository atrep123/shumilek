# BotEval Long Stability Aggregate

Generated: 2026-02-26T09:18:47.731Z
Baseline: C:\actions-runner\release_gate_stable_longrunC_20260224_075013
Inputs: 2
All gates passed: no

## Gate Failures
- C:\Users\atrep\Desktop\Test_AI_Code\shumilek\projects\bot_eval_run\release_gate_local_10x3_after_13a3703_20260224_224441: Scenario node-api-oracle: passRateDelta -0.1000 is below minimum 0.0000

## Scenario Summary

| Scenario | passRate avg(min-max) | rawRunPassRate avg(min-max) | fallbackDep avg(min-max) | avgMs avg(min-max) | avgMsDelta avg(min-max) | parse error runs (planner/jsonRepair/schema/jsonParse/placeholder/other) |
|---|---:|---:|---:|---:|---:|---|
| node-api-oracle | 95.0% (90.0%-100.0%) | 75.0% (50.0%-100.0%) | 20.0% (0.0%-40.0%) | 230852ms (89573ms-372131ms) | 135624ms (-5655ms-276903ms) | 0/0/0/0/0/3 |
| python-ai-stdlib-oracle | 100.0% (100.0%-100.0%) | 100.0% (100.0%-100.0%) | 0.0% (0.0%-0.0%) | 60665ms (41146ms-80183ms) | 18946ms (-573ms-38464ms) | 0/0/0/0/0/2 |
| ts-todo-oracle | 100.0% (100.0%-100.0%) | 100.0% (100.0%-100.0%) | 0.0% (0.0%-0.0%) | 65830ms (43315ms-88345ms) | 14717ms (-7798ms-37232ms) | 0/0/0/0/0/0 |

## Inputs
- C:\Users\atrep\Desktop\Test_AI_Code\shumilek\projects\bot_eval_run\release_gate_local_10x3_after_13a3703_20260224_224441
- C:\Users\atrep\Desktop\Test_AI_Code\shumilek\projects\bot_eval_run\release_gate_local_confirm2_20260225_202110
