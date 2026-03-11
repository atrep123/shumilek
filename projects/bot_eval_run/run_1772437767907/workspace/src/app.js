const express = require('express');
const app = express();
const { randomUUID } = require('node:crypto');
const { sendError } = require('./lib/errors');

// Middleware to parse JSON bodies
app.use(express.json());

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Project routes
const projectsRouter = require('./modules/projects/routes');
app.use('/projects', projectsRouter);

module.exports = app;