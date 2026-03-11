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
  const comment = await commentsService.addComment(req.params.projectId, req.params.taskId, message);
  res.status(201).json({ comment });
});

module.exports = router;