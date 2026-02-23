# Node.js TODO API

Tento projekt implementuje REST API pro správu TODO položek s persistencí do souboru.

## Spuštění serveru

Pokud chceš spustit server, postupuj podle těchto kroků:
1. Nainstaluj potřebné balíčky: `npm install`
2. Spusť server pomocí příkazu: `node src/server.js`

## Endpoints
- **GET /health**: Vrátí JSON s health checkem.
- **GET /openapi.json**: Vrátí OpenAPI specifikaci pro API.
- **GET /todos**: Vrátí seznam všech TODO položek.
- **POST /todos**: Přidá novou TODO položku (vyžaduje tělo s polem `title`).
- **GET /todos/:id**: Vrátí konkrétní TODO položku podle ID.
- **PATCH /todos/:id**: Aktualizuje stav TODO položky (polem `done`).
- **DELETE /todos/:id**: Odstraní TODO položku podle ID.

## Technologie
- Node.js s builtin moduly
- JSON pro persistenci dat

## Testování
Pro testování je k dispozici skript `npm test`, který spustí oracle testy.