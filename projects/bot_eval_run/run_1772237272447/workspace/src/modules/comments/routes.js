const express = require('express');
const router = express.Router();
const commentService = require('./service');

router.post('/:projectId/tasks/:taskId/comments', (req, res) => {
  const { projectId, taskId } = req.params;
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Message is required' } });
  }
  const comment = commentService.createComment(projectId, taskId, message);
  if (!comment) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found' } });
  }
  res.status(201).json({ comment });
});

module.exports = router;
