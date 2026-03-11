const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const { addProject } = require('./modules/projects/service');
const { sendError } = require('./lib/errors');

app.use(bodyParser.json());

// Add routes for projects, members, tasks, and comments
app.use('/projects', require('./modules/projects/routes'));
app.use('/projects/:projectId/members', require('./modules/members/routes'));
app.use('/projects/:projectId/tasks', require('./modules/tasks/routes'));
app.use('/projects/:projectId/tasks/:taskId/comments', require('./modules/comments/routes'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

module.exports = app;
