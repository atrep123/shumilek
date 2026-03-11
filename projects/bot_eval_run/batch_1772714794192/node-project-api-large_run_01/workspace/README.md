# Project Management API

This is a Node.js monolithic API for managing projects, tasks, members, and comments. It uses in-memory repositories and follows a modular structure under `src/modules/`.

## Features

- **In-memory persistence**: No database required.
- **Modular structure**: Separate modules for projects, tasks, members, and comments.
- **Error handling**: Consistent error payloads with shape `{ error: { code, message } }`.
- **Validation**: Handles bad input, missing entities, and duplicates with appropriate HTTP status codes.

## Getting Started

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run the server**:
   ```bash
   node src/server.js
   ```

## API Endpoints

- **GET /health**: Check the server status.
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

## Error Handling

- **400 Bad Request**: Invalid input.
- **404 Not Found**: Entity not found.
- **409 Conflict**: Duplicate entity.

## License

MIT License

Copyright (c) 2023 Your Name

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.