# Project Management API

This is a Node.js monolithic API for managing projects, tasks, members, and comments. It uses in-memory repositories and follows a modular structure under `src/modules/`.

## Features

- **In-memory persistence**: No database required.
- **Modular structure**: Separate modules for projects, tasks, members, and comments.
- **Error handling**: Consistent error payloads with shape `{ error: { code, message } }`.
- **Validation**: Handles bad input, missing entities, and duplicate entries with appropriate HTTP status codes.

## Getting Started

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd <repository-directory>
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run the server**:
   ```bash
   node src/server.js
   ```

## API Endpoints

- **GET /health**: Check the health of the API.
- **POST /projects**: Create a new project.
- **GET /projects**: List all projects.
- **GET /projects/:projectId**: Get a specific project.
- **POST /projects/:projectId/members**: Add a member to a project.
- **GET /projects/:projectId/members**: List all members of a project.
- **POST /projects/:projectId/tasks**: Create a new task for a project.
- **GET /projects/:projectId/tasks**: List all tasks of a project.
- **GET /projects/:projectId/tasks?status=done**: List all done tasks of a project.
- **PATCH /projects/:projectId/tasks/:taskId**: Update the status of a task.
- **POST /projects/:projectId/tasks/:taskId/comments**: Add a comment to a task.
- **GET /projects/:projectId/tasks/:taskId/comments**: List all comments of a task.

## Error Codes

- **400 Bad Request**: Invalid input.
- **404 Not Found**: Entity not found.
- **409 Conflict**: Duplicate entry.

## License

This project is licensed under the MIT License.
