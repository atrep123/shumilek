# Pipeline Schema

A pipeline is a JSON document with the following structure:

```json
{
  "name": "Example",
  "version": "1.0",
  "env": {
    "projectRoot": "."
  },
  "settings": {
    "maxConcurrency": 2,
    "failFast": true
  },
  "tasks": [
    {
      "id": "readme",
      "type": "file.read",
      "with": {
        "path": "{{env.projectRoot}}/README.md"
      }
    }
  ]
}
```

## Root fields

- `name` (string, required)
- `version` (string, required)
- `env` (object, optional)
- `settings` (object, optional)
  - `maxConcurrency` (number, default 1)
  - `failFast` (boolean, default true)
- `tasks` (array, required)

## Task fields

- `id` (string, required, unique)
- `type` (string, required)
- `dependsOn` (array of task IDs, optional)
- `with` (object, optional)
- `description` (string, optional)

## Supported task types

- `file.read`
- `file.write`
- `http.request`
- `delay`
- `transform`
- `collect`
- `shell.exec`
- `git.exec`
- `npm.run`
- `zip.create`
- `json.merge`

## Task type details

### shell.exec

Runs a shell command.

Fields in `with`:
- `command` (string, required)
- `args` (array of strings, optional)
- `cwd` (string, optional)
- `env` (object, optional)
- `timeoutMs` (number, optional)
- `shell` (boolean, optional)
- `stdin` (string, optional)
- `allowFailure` (boolean, optional)

### git.exec

Runs a git command (wrapper around `git`).

Fields in `with`:
- `args` (array of strings, optional)
- `cwd` (string, optional)
- `env` (object, optional)
- `timeoutMs` (number, optional)
- `allowFailure` (boolean, optional)

### npm.run

Runs an npm script.

Fields in `with`:
- `script` (string, required)
- `args` (array of strings, optional)
- `cwd` (string, optional)
- `env` (object, optional)
- `timeoutMs` (number, optional)
- `shell` (boolean, optional)
- `allowFailure` (boolean, optional)

### zip.create

Creates a zip archive.

Fields in `with`:
- `target` (string, required)
- `sources` (array of strings, required)
- `cwd` (string, optional)
- `overwrite` (boolean, optional)
- `timeoutMs` (number, optional)
- `allowFailure` (boolean, optional)

### json.merge

Merges JSON sources into one output.

Fields in `with`:
- `sources` (array of file paths or objects, required)
- `destination` (string, optional)
- `deep` (boolean, optional, default true)
- `arrayMode` (string, optional: `replace` or `concat`)
- `indent` (number, optional, default 2)

## Template values

ForgeFlow resolves `{{...}}` expressions in any string field.
Paths can reference:

- `env.KEY`
- `tasks.<taskId>.field`
- `vars.KEY`
- `meta.runId`

Example:

```
"template": "Read {{tasks.readme.bytes}} bytes"
```
