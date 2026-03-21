# Simple TODO API

This is a simple REST API for managing TODOs, implemented using Node.js with no external dependencies.

## Endpoints

- **GET /health** - Returns server health status.
- **GET /openapi.json** - Returns the OpenAPI specification.
- **GET /todos** - Lists all todos.
- **POST /todos** - Creates a new todo (requires `title` in JSON body).
- **GET /todos/:id** - Retrieves a specific todo by ID.
- **PATCH /todos/:id** - Updates a specific todo (set `done` to true).
- **DELETE /todos/:id** - Deletes a specific todo.

## Usage

To run the server, use:
```sh
npm start
```

This will start the server on port 3000. You can interact with the API using tools like `curl` or Postman.
