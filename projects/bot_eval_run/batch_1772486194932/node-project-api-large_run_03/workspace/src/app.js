const express = require('express');
const projectsRoutes = require('./modules/projects/routes');
const membersRoutes = require('./modules/members/routes');
const tasksRoutes = require('./modules/tasks/routes');
const commentsRoutes = require('./modules/comments/routes');

const app = express();
app.use(express.json());

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Mount routes
app.use('/projects', projectsRoutes);
app.use('/projects/:projectId/members', membersRoutes);
app.use('/projects/:projectId/tasks', tasksRoutes);
app.use('/projects/:projectId/tasks/:taskId/comments', commentsRoutes);

module.exports = app;
