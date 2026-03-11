// src/modules/comments/routes.js
const express = require('express');
const router = express.Router();
const commentsService = require('./service');
const { sendError } = require('../../lib/errors');

router.post('/', async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string' || message.trim() === '') {
    return sendError(res, 400, 'INVALID_MESSAGE', 'Message must be a non-empty string');
  }

  try {
    const comment = await commentsService.addComment(req.params.projectId, req.params.taskId, message);
    res.status(201).json({ comment });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
