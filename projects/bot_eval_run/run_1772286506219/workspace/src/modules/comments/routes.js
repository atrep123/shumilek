const express = require('express');
const { addCommentToTask } = require('./service');
const router = express.Router();

router.post('/:projectId/:taskId', (req, res) => {
  const comment = addCommentToTask(req.params.projectId, req.params.taskId, req.body);
  if (!comment) {
    return res.status(400).json({ error: { code: 'INVALID_MESSAGE', message: 'Message is required' } });
  }
  if (comment.error) {
    return res.status(comment.statusCode).json({ error: comment.error });
  }
  res.status(201).json({ comment });
});

router.get('/:projectId/:taskId', (req, res) => {
  const comments = getCommentsByTaskId(req.params.projectId, req.params.taskId);
  if (!comments) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found' } });
  }
  res.status(200).json({ comments });
});

module.exports = router;
