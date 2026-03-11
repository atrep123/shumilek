const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// In-memory repositories
const projectsRepo = {};
const tasksRepo = {};
const membersRepo = {};
const commentsRepo = {};

// Importing modules
const projectRouter = require('./modules/projects/router');
const taskRouter = require('./modules/tasks/router');
const memberRouter = require('./modules/members/router');
const commentRouter = require('./modules/comments/router');

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Use routers
app.use('/projects', projectRouter);
app.use('/projects/:projectId/tasks', taskRouter);
app.use('/projects/:projectId/members', memberRouter);
app.use('/projects/:projectId/tasks/:taskId/comments', commentRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'Internal Server Error'
    }
  });
});

module.exports = app;
