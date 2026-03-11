const express = require('express');
const { sendError } = require('./lib/errors');
const projectRoutes = require('./modules/projects/routes');
const memberRoutes = require('./modules/members/routes');
const taskRoutes = require('./modules/tasks/routes');
const commentRoutes = require('./modules/comments/routes');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/projects', projectRoutes);

app.use('/projects/:projectId/members', (req, res, next) => {
  req.projectId = req.params.projectId;
  next();
}, memberRoutes);

app.use('/projects/:projectId/tasks', (req, res, next) => {
  req.projectId = req.params.projectId;
  next();
}, taskRoutes);

app.use('/projects/:projectId/tasks/:taskId/comments', (req, res, next) => {
  req.taskId = req.params.taskId;
  next();
}, commentRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
});

module.exports = app;
