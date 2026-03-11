const express = require('express');
const app = express();
const projectsRouter = require('./modules/projects/routes').router;
const membersRouter = require('./modules/members/routes').router;
const tasksRouter = require('./modules/tasks/routes').router;
const commentsRouter = require('./modules/comments/routes').router;

app.use(express.json());
app.get('/health', (req, res) => { res.json({ ok: true }); });
app.use('/projects', projectsRouter);
app.use('/projects/:projectId/members', membersRouter);
app.use('/projects/:projectId/tasks', tasksRouter);
app.use('/projects/:projectId/tasks/:taskId/comments', commentsRouter);

module.exports = { app };
