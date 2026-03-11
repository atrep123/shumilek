const express = require('express');
const router = express.Router();
const commentsService = require('./service');
const { sendError } = require('../../lib/errors');

router.post('/', (req, res) => {
  const { message } = req.body;
  if (!message) {
    return sendError(res, 400, 'INVALID_MESSAGE', 'Message is required');
  }
  const comment = commentsService.addComment(req.projectId, req.taskId, message);
  res.status(201).json({ comment });
});

module.exports = router;
