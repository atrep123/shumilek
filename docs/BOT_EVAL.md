# Bot evaluation (Ollama)

Tenhle repozitář obsahuje jednoduchý eval harness, který:
1) pošle prompt do Ollamy,
2) očekává **JSON-only** odpověď se seznamem souborů,
3) zapíše projekt do `projects/bot_eval_run/run_<timestamp>/workspace`,
4) spustí validace (kompilace + testy + CLI smoke),
5) při chybě zkusí automaticky opravy přes další iterace.

## Požadavky

- Běžící Ollama (`http://localhost:11434`)
- `npm install` v rootu (kvůli `ts-node`)
- Python v PATH (`python`) nebo Windows launcher (`py -3`)
  - override: `BOT_EVAL_PYTHON="C:\\Path\\to\\python.exe"`

## Použití

- Vypsat scénáře: `npm run bot:eval -- --list`
- Doporučený scénář (oracle testy):  
  `npm run bot:eval -- --scenario python-ai-stdlib-oracle --model qwen2.5-coder:32b --maxIterations 6 --timeoutSec 1800`
- Komplexní TS úkol (kompilace + oracle testy):  
  `npm run bot:eval -- --scenario ts-todo-oracle --model qwen2.5-coder:32b --maxIterations 6 --timeoutSec 1800`
- Komplexní Node REST API (integrace + oracle testy):  
  `npm run bot:eval -- --scenario node-api-oracle --model qwen2.5-coder:32b --maxIterations 6 --timeoutSec 1800`
- Scénář kde si model píše vlastní testy (méně stabilní):  
  `npm run bot:eval -- --scenario python-ai-stdlib --model deepseek-coder-v2:16b --maxIterations 6 --timeoutSec 1800`

## Spolupráce botů (planner + reviewer)

- Přidat planner model: `--plannerModel deepseek-r1:8b`
- Přidat reviewer model: `--reviewerModel qwen2.5:3b`
- Příklad:  
  `npm run bot:eval -- --scenario ts-todo-oracle --plannerModel deepseek-r1:8b --reviewerModel qwen2.5:3b --model qwen2.5-coder:32b --maxIterations 6 --timeoutSec 1800`

## Výstupy

- Poslední run: `projects/bot_eval_run/last_run.txt`
- Každý run: `projects/bot_eval_run/run_<timestamp>/`
  - `validation.json` (souhrn PASS/FAIL)
  - `workspace/` (vygenerovaný projekt)
  - `iterations/<n>/` (prompt, raw odpověď, parsed JSON, per-iter validace + logy příkazů)

## Tipy

- Když model nestíhá, zvyšte `--timeoutSec` a/nebo snižte složitost scénáře.
- Pro rychlejší stabilní opravy zvyšte `--maxIterations` (např. 10).
- Pro stabilnejsi JSON se defaultne pouziva `--temperature 0.2 --numPredict 2400 --seed 42`.
- Pri rozbitem JSONu harness zkusi automatickou opravu JSON (json-repair).
- JSON repair lze smerovat na jiny model: `--jsonRepairModel qwen2.5:7b`.
- Batch behy (pass-rate): `npm run bot:eval:batch -- --runs 3 --scenarios ts-todo-oracle,node-api-oracle,python-ai-stdlib-oracle`.
- Doporučena kombinace modelu: `--model qwen2.5-coder:14b --plannerModel deepseek-r1:8b --reviewerModel qwen2.5:3b --jsonRepairModel qwen2.5:7b`.
- Doporučené skripty:
  - Jednotlivý run: `npm run bot:eval:recommended`
  - Batch (3× všechny scénáře): `npm run bot:eval:recommended:batch`

## CI release gate

Workflow file: `.github/workflows/bot-eval-release-gate.yml`

- PR profile: runs `npm run bot:eval:release-gate:ci -- --runs 3`
- Nightly profile: runs `npm run bot:eval:release-gate:ci -- --runs 10`
- Manual run: `workflow_dispatch` with `profile=pr|nightly`

Required runner/setup:

- self-hosted runner with Ollama running and models available
- Node.js 20 + `npm ci`

Baseline resolution in CI:

1. `BOT_EVAL_BASELINE_DIR` repository variable (recommended)
2. fallback to `projects/bot_eval_run/release_baseline.txt`

If baseline is missing or does not contain `results.json`, workflow fails with a clear error.

Useful optional repository variables:

- `BOT_EVAL_RUNNER` (default `self-hosted`)
- `OLLAMA_BASE_URL`
- `BOT_EVAL_MODEL`
- `BOT_EVAL_PLANNER_MODEL`
- `BOT_EVAL_REVIEWER_MODEL`
- `BOT_EVAL_JSON_REPAIR_MODEL`
- `BOT_EVAL_DETERMINISTIC_FALLBACK`
- `BOT_EVAL_TIMEOUT_SEC`
- `BOT_EVAL_MAX_ITERATIONS`
- `BOT_EVAL_HARD_TIMEOUT_SEC`
