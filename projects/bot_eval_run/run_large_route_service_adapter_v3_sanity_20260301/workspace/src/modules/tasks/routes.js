import express from 'express';
const router = express.Router({ mergeParams: true });
import { createTask, getTasksByStatus } from './service.js';
import { sendError } from '../../lib/errors.js';

router.post('/', async (req, res) => {
  const { title, status } = req.body;
  if (!title || !status) return sendError(res, 400, 'BadRequest', 'Title and status are required');
  try {
    const task = await createTask(req.params.projectId, title, status);
    res.status(201).json({ task });
  } catch (error) {
    if (error.code === 'Duplicate') return sendError(res, 409, 'Conflict', error.message);
    sendError(res, 500, 'ServerError', error.message);
  }
});

router.get('/', async (req, res) => {
  const { status } = req.query;
  try {
    const tasks = await getTasksByStatus(req.params.projectId, status);
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'ServerError', error.message);
  }
});

export default router;