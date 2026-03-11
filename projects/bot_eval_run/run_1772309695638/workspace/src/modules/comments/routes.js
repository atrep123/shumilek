const express = require('express');
const { sendError } = require('../../lib/errors');
const commentsService = require('./service');

const router = express.Router();

router.post('/', (req, res) => {
  const { message } = req.body;
  if (!message) {
    return sendError(res, 400, 'INVALID_INPUT', 'Message is required');
  }

  const comment = commentsService.addComment(req.projectId, req.taskId, { message });
  res.status(201).json({ comment });
});

router.get('/', (req, res) => {
  const comments = commentsService.getComments(req.projectId, req.taskId);
  res.json({ comments });
});

module.exports = router;
