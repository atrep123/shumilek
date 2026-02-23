# Usage

## CLI

Validate a pipeline:

```bash
node dist/cli.js validate examples/sample.pipeline.json
```

Run a pipeline and write a report:

```bash
node dist/cli.js run examples/sample.pipeline.json --report reports/sample-run.json
```

Start the HTTP API:

```bash
node dist/cli.js serve --port 7070
```

## HTTP API

Validate:

```bash
curl -X POST http://localhost:7070/pipelines/validate \
  -H "Content-Type: application/json" \
  -d @examples/sample.pipeline.json
```

Run:

```bash
curl -X POST http://localhost:7070/runs \
  -H "Content-Type: application/json" \
  -d @examples/sample.pipeline.json
```

Get run report:

```bash
curl http://localhost:7070/runs/<runId>
```

## Task examples

Run a shell command:

```json
{
  "id": "list",
  "type": "shell.exec",
  "with": {
    "command": "node",
    "args": ["-e", "console.log('ok')"]
  }
}
```

Merge JSON files:

```json
{
  "id": "merge-config",
  "type": "json.merge",
  "with": {
    "sources": ["config/base.json", "config/override.json"],
    "destination": "reports/merged.json",
    "arrayMode": "concat"
  }
}
```

## Configuration

ForgeFlow loads configuration from the first file found:

- `forgeflow.config.json`
- `.forgeflowrc.json`

Fields:

- `projectRoot` (string)
- `reportDir` (string)
- `maxConcurrency` (number)
- `failFast` (boolean)
- `serverPort` (number)

Example:

```json
{
  "projectRoot": ".",
  "reportDir": "reports",
  "maxConcurrency": 2,
  "failFast": true,
  "serverPort": 7070
}
```
