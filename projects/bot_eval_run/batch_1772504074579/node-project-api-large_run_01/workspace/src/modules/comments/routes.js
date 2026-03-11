// src/modules/comments/routes.js
const express = require('express');
const commentsService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return sendError(res, 400, 'INVALID_MESSAGE', 'Invalid comment message');
    }
    const newComment = await commentsService.addComment(req.params.projectId, req.params.taskId, message);
    res.status(201).json({ comment: newComment });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
