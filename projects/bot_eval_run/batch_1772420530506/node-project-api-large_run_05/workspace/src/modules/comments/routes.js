// src/modules/comments/routes.js
const express = require('express');
const commentsService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return sendError(res, 400, 'INVALID_INPUT', 'Message is required');
  }
  try {
    const comment = await commentsService.addComment(req.params.projectId, req.params.taskId, message);
    res.status(201).json({ comment });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') {
      return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    }
    if (error.code === 'TASK_NOT_FOUND') {
      return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
