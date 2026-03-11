const express = require('express');
const commentsService = require('./service');

const router = express.Router();

router.post('/', (req, res) => {
  const { message } = req.body;
  if (!content) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Message is required' } });
  }
  const comment = commentsService.addComment(req.params.projectId, req.params.taskId, message);
  res.status(201).json({ comment });
});

router.get('/', (req, res) => {
  const comments = commentsService.getAllComments(req.params.projectId, req.params.taskId);
  if (!comments) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found' } });
  }
  res.json({ comments });
});

module.exports = router;
