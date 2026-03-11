import express from 'express';
const router = express.Router({ mergeParams: true });
import { addTask, getTasks, updateTaskStatus } from './service.js';
import { sendError } from '../../lib/errors.js';

router.post('/', (req, res) => {
  const task = addTask(req.params.id, req.body);
  if (!task) return sendError(res, 404, 'NotFoundError', 'Project not found');
  try {
    res.status(201).send({ task });
  } catch (error) {
    sendError(res, 500, 'InternalServerError', error.message);
  }
});

router.get('/', (req, res) => {
  const tasks = getTasks(req.params.id, req.query.status);
  if (!tasks) return sendError(res, 404, 'NotFoundError', 'Project not found');
  try {
    res.send({ tasks });
  } catch (error) {
    sendError(res, 500, 'InternalServerError', error.message);
  }
});

router.patch('/:taskId', (req, res) => {
  const task = updateTaskStatus(req.params.taskId, req.body.status);
  if (!task) return sendError(res, 404, 'NotFoundError', 'Task not found');
  try {
    res.send({ task });
  } catch (error) {
    sendError(res, 500, 'InternalServerError', error.message);
  }
});

export default router;
