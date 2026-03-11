// src/modules/comments/routes.js
const express = require('express');
const router = express.Router();
const commentsService = require('./service');
const { sendError } = require('../../lib/errors');

router.post('/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const { message } = req.body;
  if (!message) {
    return sendError(res, 400, 'INVALID_INPUT', 'Invalid input data');
  }
  try {
    const comment = await commentsService.createComment(taskId, message);
    res.status(201).json({ comment });
  } catch (error) {
    if (error.code === 'NOT_FOUND') {
      return sendError(res, 404, 'NOT_FOUND', error.message);
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
