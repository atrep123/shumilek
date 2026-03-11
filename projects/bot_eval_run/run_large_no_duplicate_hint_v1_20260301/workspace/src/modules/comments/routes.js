import express from 'express';
const router = express.Router({ mergeParams: true });
import { addComment } from './service.js';
import { sendError } from '../../lib/errors.js';

router.post('/', (req, res) => {
  const { message } = req.body;
  if (!message) return sendError(res, 400, 'BadRequestError', 'Message is required');
  try {
    addComment({ taskId: req.params.taskId, ...req.body });
    res.status(201).send({ comment: { message } });
  } catch (error) {
    sendError(res, 500, 'InternalServerError', error.message);
  }
});

export default router;
