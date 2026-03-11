// src/modules/comments/routes.js
const express = require('express');
const commentsService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  const { message } = req.body;
  if (!content || typeof content !== 'string' || content.trim() === '') {
    return sendError(res, 400, 'INVALID_CONTENT', 'Content must be a non-empty string');
  }
  try {
    const comment = await commentsService.addComment(req.params.projectId, req.params.taskId, message);
    res.status(201).json({ comment });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
