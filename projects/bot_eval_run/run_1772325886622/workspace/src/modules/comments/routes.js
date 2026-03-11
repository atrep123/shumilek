const express = require('express');
const { sendError } = require('../../lib/errors');
const commentsService = require('./service');

const router = express.Router();

router.post('/', (req, res) => {
  const { projectId, taskId } = req.params;
  const { message } = req.body;
  if (!message) {
    return sendError(res, 400, 'INVALID_MESSAGE', 'Message is required');
  }
  const comment = commentsService.addComment(projectId, taskId, message);
  if (!comment) {
    return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
  }
  res.status(201).json({ comment });
});

module.exports = router;
