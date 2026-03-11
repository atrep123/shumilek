const express = require('express');
const { sendError } = require('../../lib/errors');
const commentService = require('./service');

const router = express.Router();

router.post('/', (req, res) => {
  const { message } = req.body;
  if (!message) return sendError(res, 400, 'INVALID_MESSAGE', 'Message is required');

  const projectId = req.params.projectId;
  const taskId = req.params.taskId;
  const comment = commentService.addComment(projectId, taskId, message);
  if (!comment) return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');

  res.status(201).json({ comment });
});

router.get('/', (req, res) => {
  const projectId = req.params.projectId;
  const taskId = req.params.taskId;
  const comments = commentService.getCommentsByTask(projectId, taskId);
  if (!comments) return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');

  res.json({ comments });
});

module.exports = router;
