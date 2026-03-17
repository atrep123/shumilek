# Project Management API
This is a Node.js monolithic application for managing projects, tasks, members, and comments. It uses in-memory repositories and follows a modular structure under `src/modules/`.

## Features
- In-memory data storage
- Modular architecture with separate modules for projects, tasks, members, and comments
- RESTful API endpoints for CRUD operations
- Error handling with consistent payload shape `{ error: { code, message } }`

## Getting Started
1. Clone the repository.
2. Install dependencies using `npm install`.
3. Run the application using `node src/server.js`.

## Endpoints
- **GET /health**: Check the health of the API.
- **POST /projects**: Create a new project.
- **GET /projects**: List all projects.
- **GET /projects/:projectId**: Get a specific project by ID.
- **POST /projects/:projectId/members**: Add a member to a project.
- **GET /projects/:projectId/members**: List all members of a project.
- **POST /projects/:projectId/tasks**: Create a new task for a project.
- **GET /projects/:projectId/tasks**: List all tasks of a project.
- **GET /projects/:projectId/tasks?status=done**: Filter tasks by status (e.g., done).
- **PATCH /projects/:projectId/tasks/:taskId**: Update the status of a task.
- **POST /projects/:projectId/tasks/:taskId/comments**: Add a comment to a task.
- **GET /projects/:projectId/tasks/:taskId/comments**: List all comments of a task.