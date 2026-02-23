# Architecture

ForgeFlow is split into three layers:

1) Interface layer
- CLI (`src/cli.ts`)
- HTTP server (`src/server.ts`)

2) Orchestration layer
- Pipeline runner (`src/runner/pipelineRunner.ts`)
- Validation (`src/runner/validator.ts`)
- Context and templating (`src/runner/context.ts`, `src/runner/template.ts`)

3) Task layer
- Task handlers live in `src/tasks/`
- A registry maps `task.type` to a handler

## Data flow

1) Input pipeline JSON is loaded by the CLI or HTTP server.
2) The validator checks structure, dependencies, and cycles.
3) The runner resolves task inputs using template interpolation.
4) Tasks execute with controlled concurrency.
5) Results are collected into a run report.

## Execution model

- Each task has an ID and optional dependencies.
- A task starts only when its dependencies are complete.
- The runner enforces a maximum concurrency limit.
- Fail-fast behavior is configurable in the pipeline settings.

## Outputs

- Each task result is stored under `tasks.<id>` in the context.
- The final run report contains timings, status, and outputs.
