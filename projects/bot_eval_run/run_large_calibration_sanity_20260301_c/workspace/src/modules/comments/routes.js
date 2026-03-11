const express = require('express');
const router = express.Router({ mergeParams: true });
const service = require('./service');

// Create a new comment
router.post('/', async (req, res) => {
  if (!req.body.message) return sendError(res, 400, 'MissingMessage', 'Comment message is required');
  const comment = await service.createComment({ message: req.body.message, taskId: req.params.taskId });
  res.status(201).json({ comment });
});

// Get comments for a task
router.get('/', async (req, res) => {
  const comments = await service.getCommentsForTask(req.params.taskId);
  res.json({ comments });
});

module.exports = router;
