# Node.js TODO API Project

This project is a simple REST API for managing TODO items, built using only Node.js builtin modules.

## Features
- **RESTful API** for CRUD operations on TODO items.
- Persistence via JSON file.

## Endpoints
- `GET /health` -> Returns { ok: true }
- `GET /openapi.json` -> OpenAPI 3.x specification with paths for `/todos`.
- `GET /todos` -> List all TODOs.
- `POST /todos` -> Create a new TODO (body should contain `{title}`).
- `GET /todos/:id` -> Get a specific TODO by ID.
- `PATCH /todos/:id` -> Update a specific TODO (body should contain `{done: true}`).
- `DELETE /todos/:id` -> Delete a specific TODO.

## Usage
1. Clone the repository.
2. Run `npm install` to install dependencies.
3. Start the server with `node src/server.js`.

## Testing
To run tests, use the command `node --test tests/oracle.test.js`.
