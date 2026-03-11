// src/modules/comments/routes.js
const express = require('express');
const commentsService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { message } = req.body;
    if (!content) {
      return sendError(res, 400, 'INVALID_INPUT', 'Message is required');
    }
    const comment = await commentsService.addComment(req.params.projectId, req.params.taskId, message);
    res.status(201).json({ comment });
  } catch (error) {
    if (error.code === 'DUPLICATE') {
      return sendError(res, 409, 'DUPLICATE', 'Comment already exists');
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
