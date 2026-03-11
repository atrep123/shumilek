const express = require('express');
const router = express.Router({ mergeParams: true });
const { createComment, getCommentsByTask } = require('./service');

router.post('/', async (req, res) => {
  const comment = await createComment(req.params.taskId, req.body);
  if (!comment) return sendError(res, 404, 'NOT_FOUND', 'Task not found');
  res.status(201).json({ comment });
});

router.get('/', async (req, res) => {
  const comments = await getCommentsByTask(req.params.taskId);
  if (!comments) return sendError(res, 404, 'NOT_FOUND', 'Task not found');
  res.json({ comments });
});

module.exports = router;
