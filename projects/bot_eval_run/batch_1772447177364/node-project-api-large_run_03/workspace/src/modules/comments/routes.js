// src/modules/comments/routes.js
const express = require('express');
const router = express.Router();
const service = require('./service');
const { sendError } = require('../../lib/errors');

router.post('/', async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return sendError(res, 400, 'INVALID_INPUT', 'Message is required.');
  }
  try {
    const comment = await service.addComment(req.params.projectId, req.params.taskId, { message });
    res.status(201).json({ comment });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
});

module.exports = router;
