// src/modules/comments/routes.js
const express = require('express');
const commentsService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  const projectId = req.params.projectId;
  const taskId = req.params.taskId;
  try {
    const comments = await commentsService.getCommentsByTask(projectId, taskId);
    res.json({ comments });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch comments');
  }
});

router.post('/', async (req, res) => {
  const projectId = req.params.projectId;
  const taskId = req.params.taskId;
  const { message } = req.body;
  if (!message) {
    return sendError(res, 400, 'INVALID_INPUT', 'Message is required');
  }

  try {
    const comment = await commentsService.createComment(projectId, taskId, message);
    res.status(201).json({ comment });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create comment');
  }
});

module.exports = router;
