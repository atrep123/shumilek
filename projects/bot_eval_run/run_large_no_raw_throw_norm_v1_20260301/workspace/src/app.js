const express = require('express');
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Project routes
const projectsRouter = require('./modules/projects/routes');
app.use('/projects', projectsRouter);

module.exports.app = app;
