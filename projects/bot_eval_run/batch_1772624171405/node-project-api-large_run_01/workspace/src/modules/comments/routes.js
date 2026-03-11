const router = require('express').Router({ mergeParams: true });
const commentsService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', async (req, res) => {
  const comments = await commentsService.getComments(req.params.taskId);
  if (!comments) return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
  res.json({ comments });
});

router.post('/', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return sendError(res, 400, 'BAD_REQUEST', 'Message is required');

  const comment = await commentsService.addComment(req.params.taskId, message);
  if (!comment) return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');

  res.status(201).json({ comment });
});

module.exports = router;
