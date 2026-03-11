const express = require('express');
const app = express();
const { createProject } = require('./modules/projects/service');
const { createTask } = require('./modules/tasks/service');
const { createComment } = require('./modules/comments/service');
const { createMember } = require('./modules/members/service');

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Projects routes
const projectsRouter = require('./modules/projects/routes');
app.use('/projects', projectsRouter);

// Members routes
app.use('/projects/:projectId/members', require('./modules/members/routes'));

// Tasks routes
app.use('/projects/:projectId/tasks', require('./modules/tasks/routes'));

// Comments routes
app.use('/projects/:projectId/tasks/:taskId/comments', require('./modules/comments/routes'));

module.exports = app;
