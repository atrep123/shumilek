const express = require('express');
const commentService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', (req, res) => {
  const projectId = req.params.projectId;
  const taskId = req.params.taskId;
  const { message } = req.body;
  if (!message) {
    return sendError(res, 400, 'INVALID_BODY', 'Message is required');
  }
  const comment = commentService.addComment(projectId, taskId, message);
  if (!comment) {
    return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
  }
  res.status(201).json({ comment });
});

router.get('/', (req, res) => {
  const projectId = req.params.projectId;
  const taskId = req.params.taskId;
  const comments = commentService.getComments(projectId, taskId);
  if (!comments) {
    return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
  }
  res.json({ comments });
});

module.exports = router;
