const express = require('express');
const app = express();
const crypto = require('crypto');
require('./lib/errors')();

// Middleware to parse JSON bodies
app.use(express.json());

// Routes
app.use('/projects', require('./modules/projects/routes'));
app.use('/projects/:projectId/members', require('./modules/members/routes'));
app.use('/projects/:projectId/tasks', require('./modules/tasks/routes'));
app.use('/projects/:projectId/tasks/:taskId/comments', require('./modules/comments/routes'));

// Start the server
module.exports = app;
