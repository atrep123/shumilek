# Project Management API
This is a Node.js monolithic application for managing projects, tasks, members, and comments. It uses in-memory repositories and follows a modular structure under `src/modules/`.

## Dependencies
- express
- zod
- supertest (for testing)

## Running the Application
To run the application, you can use the following commands:

```bash
npm install
node src/server.js
```

## API Endpoints
- **GET /health**: Returns `{ ok: true }`.
- **POST /projects**: Creates a new project.
- **GET /projects**: Lists all projects.
- **GET /projects/:projectId**: Retrieves a specific project by ID.
- **POST /projects/:projectId/members**: Adds a member to a project.
- **GET /projects/:projectId/members**: Lists all members of a project.
- **POST /projects/:projectId/tasks**: Creates a new task for a project.
- **GET /projects/:projectId/tasks**: Lists all tasks of a project.
- **GET /projects/:projectId/tasks?status=done**: Filters tasks by status 'done'.
- **PATCH /projects/:projectId/tasks/:taskId**: Updates the status of a task.
- **POST /projects/:projectId/tasks/:taskId/comments**: Adds a comment to a task.
- **GET /projects/:projectId/tasks/:taskId/comments**: Lists all comments of a task.