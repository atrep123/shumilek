// src/modules/comments/routes.js
const express = require('express');
const commentsService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

// Add a comment to a task
router.post('/', async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string' || message.trim() === '') {
    return sendError(res, 400, 'INVALID_MESSAGE', 'Invalid comment message');
  }
  try {
    const newComment = await commentsService.addComment(req.params.projectId, req.params.taskId, message);
    res.status(201).json({ comment: newComment });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

// Get all comments for a task
router.get('/', async (req, res) => {
  try {
    const comments = await commentsService.getAllComments(req.params.projectId, req.params.taskId);
    res.json({ comments });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
