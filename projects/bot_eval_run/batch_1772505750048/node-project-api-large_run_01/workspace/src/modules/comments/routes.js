const express = require('express');
commentsService = require('./service');
sendError = require('../../lib/errors').sendError;

const router = express.Router();

// Create a new comment for a task
router.post('/', (req, res) => {
  const { projectId, taskId } = req.params;
  const { message } = req.body;
  if (!message) {
    return sendError(res, 400, 'INVALID_COMMENT', 'Comment message is required');
  }
  const comment = commentsService.createComment(projectId, taskId, message);
  if (!comment) {
    return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
  }
  res.status(201).json({ comment });
});

// Get all comments for a task
router.get('/', (req, res) => {
  const { projectId, taskId } = req.params;
  const comments = commentsService.getCommentsByTaskId(projectId, taskId);
  if (!comments) {
    return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
  }
  res.json({ comments });
});

module.exports = router;
