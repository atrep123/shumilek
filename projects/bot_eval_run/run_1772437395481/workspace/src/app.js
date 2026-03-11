import express from 'express';
import { randomUUID } from 'node:crypto';
import { sendError } from './lib/errors';
import projectsRouter from './modules/projects/routes';
import membersRouter from './modules/members/routes';
import tasksRouter from './modules/tasks/routes';
import commentsRouter from './modules/comments/routes';

const app = express();
app.use(express.json());

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Routes
app.use('/projects', projectsRouter);
app.use('/projects/:projectId/members', membersRouter);
app.use('/projects/:projectId/tasks', tasksRouter);
app.use('/projects/:projectId/tasks/:taskId/comments', commentsRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  if (err) {
    sendError(res, err.status || 500, err.code || 'INTERNAL_ERROR', err.message || 'Internal Server Error');
  } else {
    next();
  }
});

export default app;