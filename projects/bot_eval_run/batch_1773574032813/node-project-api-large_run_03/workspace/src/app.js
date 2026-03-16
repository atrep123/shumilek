const express = require('express');
const projectsRouter = require('./modules/projects/routes');
const membersRouter = require('./modules/projects/members/routes');
const tasksRouter = require('./modules/projects/tasks/routes');
const commentsRouter = require('./modules/projects/tasks/comments/routes');

const app = express();

app.use(express.json());

app.use('/projects', projectsRouter);
app.use('/projects/:projectId/members', membersRouter);
app.use('/projects/:projectId/tasks', tasksRouter);
app.use('/projects/:projectId/tasks/:taskId/comments', commentsRouter);

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

module.exports = app;
