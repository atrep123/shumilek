# TODO API
This is a simple Node.js project that implements a RESTful API for managing TODO items.

## Usage
1. Install dependencies: `npm install`
2. Start the server: `node src/server.js`
3. Use any HTTP client (e.g., Postman) to send requests to the following endpoints:
- GET /health: Returns a simple health check response.
- GET /openapi.json: Returns the OpenAPI specification for the API.
- GET /todos: Returns all TODO items.
- GET /todos/:id: Returns a specific TODO item by ID.
- POST /todos: Creates a new TODO item. Requires a `title` field in the request body.
- PATCH /todos/:id: Updates a specific TODO item's `done` status. Requires a `done` field in the request body.
- DELETE /todos/:id: Deletes a specific TODO item by ID.

## Notes
- The server uses the `http` module and handles requests with callbacks.
- Error responses are sent as JSON objects with appropriate HTTP status codes.
- The API follows the OpenAPI 3.0 specification.