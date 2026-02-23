# TODO API

Tento projekt implementuje REST API pro správu TODO položek s persistencí do souboru.

## Endpoints:
- `GET /health` - Zdravotní stav serveru.
- `GET /openapi.json` - OpenAPI specifikace API.
- `GET /todos` - Seznam všech TODO položek.
- `POST /todos` - Vytvořit novou TODO položku (povinný titul).
- `GET /todos/:id` - Detail jedné TODO položky.
- `PATCH /todos/:id` - Aktualizace stavu TODO položky (dokončeno).
- `DELETE /todos/:id` - Odstranit TODO položku.

## Instalace a spuštění:
1. Nainstalujte závislosti: `npm install`
2. Spusťte server: `node src/server.js`

## Testování:
Pro testování je k dispozici skript v souboru `tests/oracle.test.js`. Ujistěte se, že máte nainstalovaný Node.js a npm pro spuštění těchto testů.

