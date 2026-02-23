# TODO API

Tento projekt implementuje REST API pro správu TODO položek s možností persistenci dat do souboru.

## Endpoints:
- **GET /health** - Zdravotní stav serveru.
- **GET /openapi.json** - OpenAPI specifikace API.
- **GET /todos** - Seznam všech TODO položek.
- **POST /todos** - Vytvořit novou TODO položku (vyžaduje JSON s polem `title`).
- **GET /todos/:id** - Získat konkrétní TODO položku podle ID.
- **PATCH /todos/:id** - Aktualizovat stav TODO položky (upravit JSON s polem `done`).
- **DELETE /todos/:id** - Smazat TODO položku podle ID.

## Instalace a spuštění:
1. Nainstalujte závislosti: `npm install`
2. Spusťte server: `node src/server.js`

## Testování:
Pro testování API lze použít skripty uvedené v [tests/oracle.test.js](tests/oracle.test.js).