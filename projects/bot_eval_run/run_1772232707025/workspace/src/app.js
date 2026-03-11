const express = require('express');
const projectsRoutes = require('./modules/projects/routes');
const tasksRoutes = require('./modules/tasks/routes');
const membersRoutes = require('./modules/members/routes');
const commentsRoutes = require('./modules/comments/routes');

const app = express();
app.use(express.json());

app.use('/projects', projectsRoutes);
app.use('/projects/:projectId/tasks', tasksRoutes);
app.use('/projects/:projectId/tasks/:taskId/comments', commentsRoutes);
app.use('/projects/:projectId/members', membersRoutes);

module.exports = app;
