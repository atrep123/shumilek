## Summary
Stabilizes the manual large benchmark scenario `node-project-api-large` with hybrid timeout/retry hardening and stronger contract-aware diagnostics/autofixes.

## Scope
- Internal `botEval` orchestration only
- New/expanded tests for large-scenario stabilization
- No VS Code extension public API changes
- No release-gate threshold changes

## Key Changes
1. Large scenario robustness
- Added/expanded `node-project-api-large` scenario flow in `scripts/botEval.ts`.
- Improved structural/full-mode handling and repair-loop behavior for large outputs.
- Added route/service contract guidance and guardrails.

2. Timeout/retry hardening
- Added retry cap env: `BOT_EVAL_OLLAMA_RETRY_MAX_TIMEOUT_MS`.
- Disabled retry amplification for long generation calls.
- Tuned timeout-fallback generation cap for large scenario.

3. Contract-aware autofix improvements
- Added `generateId` helper contract guard/fix (`src/lib/id.*`).
- Expanded actionable diagnostics (including `TypeError: generateId is not a function`).
- Kept deterministic fallback disabled for `node-project-api-large`.

4. Batch/infra support
- Extended batch infra handling and recovery/restart test coverage.

5. Oracle + tests
- Added large scenario oracle fixture:
  - `scripts/botEval/oracle/node_project_api_large/tests/oracle.test.js`
- Added/expanded tests:
  - `test/botEvalLargeScenario.test.ts`
  - `test/botEvalBatchInfra.test.ts`
  - `test/botEvalOllamaRetry.test.ts`

## Validation
Local:
- `npm run compile` ✅
- `npm test -- test/botEvalLargeScenario.test.ts test/botEvalBatchInfra.test.ts test/botEvalOllamaRetry.test.ts` ✅

Runtime evidence:
- 32b stress (`runs=5`, `maxIterations=12`): **5/5 pass**
- 32b additional batches after fixes: **3/3** and **3/3 pass**
- 14b long batch (`runs=5`, `maxIterations=12`): **5/5 pass**
- `fallbackDependencyRunRate = 0%`

Evidence files:
- `projects/bot_eval_run/large_hybrid_stabilization_checkpoint_20260305.md`
- `projects/bot_eval_run/large_hybrid_stabilization_checkpoint_20260305.json`

## Risk / Rollout
- Keep scenario **manual-only** for now.
- Monitor additional manual runs before considering non-blocking nightly integration.
