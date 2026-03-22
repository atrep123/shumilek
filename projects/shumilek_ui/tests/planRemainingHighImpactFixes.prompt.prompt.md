# Plan: Remaining High-Impact Fixes

1. Add concurrent request guard in chat flow (HIGH / SMALL)
- Problem: concurrent `handleChatInternal` calls can interleave writes to shared `chatMessages` and contend over global `abortController`.
- Change:
  - Add a backend in-flight guard to reject/queue overlapping top-level chat requests.
  - Keep retries internal and exempt from the outer guard.
  - Ensure guard reset in `finally`.
- Validation:
  - Add tests for double-submit behavior and guard reset after failure/abort.

2. Fix command approval scope mismatch (MEDIUM / SMALL)
- Problem: `run_terminal_command` currently follows edit approval semantics, making `autoApprove.commands` effectively unused.
- Change:
  - Route `run_terminal_command` through command-specific approval policy.
  - Keep edit approval for file mutation tools only.
- Validation:
  - Add policy tests for combinations of `autoApprove.edit` and `autoApprove.commands`.

3. Decompose `runToolCall` monolith into handlers (MEDIUM / LARGE)
- Problem: very large switch-based function with low unit-testability and high change risk.
- Change:
  - Extract handlers into a dedicated module (typed dispatcher + per-tool handlers).
  - Keep current behavior parity and response contract.
  - Start with high-risk mutation tools first (`write_file`, `replace_lines`, `run_terminal_command`).
- Validation:
  - Add unit tests for extracted handlers and dispatcher routing.
  - Run compile, full tests, and release gate.

Execution order
1. Concurrent request guard
2. Command approval scope fix
3. `runToolCall` decomposition

Per-step done criteria
- TypeScript compile passes
- Full test suite passes
- Release gate passes
- Single focused commit per step
