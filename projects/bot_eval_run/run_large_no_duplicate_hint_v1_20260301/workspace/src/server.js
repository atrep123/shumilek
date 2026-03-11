import express from 'express';
import cors from 'cors';
import projectsRouter from './modules/projects/routes.js';
import membersRouter from './modules/members/routes.js';
import tasksRouter from './modules/tasks/routes.js';
import commentsRouter from './modules/comments/routes.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.send({ ok: true });
});

app.use('/projects', projectsRouter);
app.use('/projects/:id/members', membersRouter);
app.use('/projects/:id/tasks', tasksRouter);
app.use('/projects/:id/tasks/:taskId/comments', commentsRouter);

export default app;
