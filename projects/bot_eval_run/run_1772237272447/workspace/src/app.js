const express = require('express');
const app = express();

app.use(express.json());

// Import routes
const projectRoutes = require('./modules/projects/routes');
const taskRoutes = require('./modules/tasks/routes');
const memberRoutes = require('./modules/members/routes');
const commentRoutes = require('./modules/comments/routes');

// Use routes
app.use('/projects', projectRoutes);
app.use('/projects/:projectId/tasks', taskRoutes);
app.use('/projects/:projectId/tasks/:taskId/comments', commentRoutes);
app.use('/projects/:projectId/members', memberRoutes);

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({ message: 'API is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err.code && err.message) {
    return res.status(400).json({ error: { code: err.code, message: err.message } });
  }
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong!' } });
});

module.exports = app;
