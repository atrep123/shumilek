# Project Management API

This is a simple project management API built with Node.js and Express.

## Endpoints

- **GET /health**: Returns `{ ok: true }` to check the health of the server.
- **POST /projects**: Creates a new project. Requires `name` in the request body.
- **GET /projects**: Retrieves a list of all projects.
- **GET /projects/:projectId**: Retrieves a specific project by ID.
- **POST /projects/:projectId/members**: Adds a member to a project. Requires `userId` and `role` in the request body.
- **GET /projects/:projectId/members**: Retrieves members of a specific project.
- **POST /projects/:projectId/tasks**: Creates a new task for a project. Status defaults to `todo`.
- **GET /projects/:projectId/tasks**: Retrieves all tasks of a specific project.
- **GET /projects/:projectId/tasks?status=done**: Filters and retrieves only the done tasks of a specific project.
- **POST /projects/:projectId/tasks/:taskId/comments**: Adds a comment to a task. Requires `message` in the request body.
- **GET /projects/:projectId/tasks/:taskId/comments**: Retrieves comments for a specific task.

## Dependencies

- Express
- Supertest (for testing)

## Running the Project

1. Install dependencies: `npm install`
2. Run tests: `node --test --test-concurrency=1 tests/oracle.test.js`
3. Start the server: `node src/server.js`
