# ForgeFlow

ForgeFlow is a local workflow runner that executes JSON pipelines.
It provides:
- A CLI for validating and running pipelines
- A small HTTP API for remote execution
- A structured run report in JSON

## Quick start

```bash
cd projects/forgeflow
npm install
npm run build
node dist/cli.js validate examples/sample.pipeline.json
node dist/cli.js run examples/sample.pipeline.json
```

## CLI

```bash
forgeflow <command> [options]

Commands:
  init <dir>             Create sample config and pipeline
  validate <file>        Validate a pipeline JSON
  run <file>             Run a pipeline JSON
  serve                  Start HTTP API server
```

Examples:

```bash
node dist/cli.js validate examples/sample.pipeline.json
node dist/cli.js run examples/sample.pipeline.json --report reports/run.json
node dist/cli.js serve --port 7070
```

Additional pipeline: `examples/extended.pipeline.json`.

## HTTP API

```bash
POST /pipelines/validate
POST /runs
GET  /runs/<runId>
GET  /health
```

See `docs/USAGE.md` for full request/response examples.

## Built-in tasks

- file.read / file.write
- http.request
- delay
- transform
- collect
- shell.exec
- git.exec
- npm.run
- zip.create
- json.merge

## Build and test

```bash
npm run build
npm test
```

## Project structure

```
projects/forgeflow/
  src/           core code
  docs/          documentation
  examples/      sample pipelines
  test/          Node test runner tests
```
