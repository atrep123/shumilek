# TODO API

A simple REST API for managing TODO items using Node.js.

## Endpoints

- **GET /health**: Returns the health status of the server.
- **GET /openapi.json**: Returns the OpenAPI 3.x specification for the TODO endpoints.
- **GET /todos**: Retrieves all TODO items.
- **POST /todos**: Creates a new TODO item.
- **GET /todos/:id**: Retrieves a specific TODO item by ID.
- **PATCH /todos/:id**: Updates a specific TODO item by marking it as done.
- **DELETE /todos/:id**: Deletes a specific TODO item by ID.