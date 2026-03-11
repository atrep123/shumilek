// src/modules/comments/routes.js
const express = require('express');
const { sendError } = require('../../lib/errors');
const commentsService = require('./service');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { message } = req.body;
    if (!content || typeof content !== 'string') {
      return sendError(res, 400, 'INVALID_INPUT', 'Invalid input');
    }
    const comment = await commentsService.addComment(req.params.projectId, req.params.taskId, message);
    res.status(201).json({ comment });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND' || error.code === 'TASK_NOT_FOUND') {
      return sendError(res, 404, error.code, error.message);
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
