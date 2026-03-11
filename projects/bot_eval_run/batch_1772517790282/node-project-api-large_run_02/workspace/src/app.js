const express = require('express');
const projectsRoutes = require('./modules/projects/routes');
const membersRoutes = require('./modules/members/routes');
const tasksRoutes = require('./modules/tasks/routes');
const commentsRoutes = require('./modules/comments/routes');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/projects', projectsRoutes);

app.use('/projects/:projectId/members', (req, res, next) => {
  req.projectId = req.params.projectId;
  next();
}, membersRoutes);

app.use('/projects/:projectId/tasks', (req, res, next) => {
  req.projectId = req.params.projectId;
  next();
}, tasksRoutes);

app.use('/projects/:projectId/tasks/:taskId/comments', (req, res, next) => {
  req.taskId = req.params.taskId;
  next();
}, commentsRoutes);

module.exports = app;
