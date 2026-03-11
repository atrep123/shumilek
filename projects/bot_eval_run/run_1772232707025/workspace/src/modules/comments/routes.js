const express = require('express');
const service = require('./service');

const router = express.Router();

router.get('/:projectId/tasks/:taskId/comments', (req, res) => {
  const comments = service.getAllComments(req.params.projectId, req.params.taskId);
  if (!comments) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found' } });
  }
  res.json({ comments });
});

router.post('/:projectId/tasks/:taskId/comments', (req, res) => {
  const comment = service.createComment(req.params.projectId, req.params.taskId, req.body);
  if (!comment) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found' } });
  }
  res.status(201).json({ comment });
});

module.exports = router;
