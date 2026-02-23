# TODO API
This is a simple Node.js project that implements a RESTful API for managing TODO items.

## Endpoints
- GET /health: Returns a health check response.
- GET /openapi.json: Returns the OpenAPI specification of the API.
- GET /todos: Returns all TODO items.
- GET /todos/:id: Returns a specific TODO item by ID.
- POST /todos: Creates a new TODO item.
- PATCH /todos/:id: Updates a specific TODO item by ID.
- DELETE /todos/:id: Deletes a specific TODO item by ID.

## Running the Project
1. Clone this repository.
2. Navigate to the project directory.
3. Run `npm install` to install dependencies.
4. Create an empty file named `data.json` in the `src` directory as the data storage.
5. Start the server with `node src/server.js`.
6. Use a tool like Postman or curl to test the API endpoints.

## Example Usage
- To create a new TODO item: `curl -X POST http://localhost:3000/todos -H 'Content-Type: application/json' -d '{
  "title": "Buy milk"
}'`
