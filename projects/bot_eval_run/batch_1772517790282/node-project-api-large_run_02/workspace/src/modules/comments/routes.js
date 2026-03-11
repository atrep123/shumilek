const express = require('express');
const service = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', (req, res) => {
  const { message } = req.body;
  if (!message) {
    return sendError(res, 400, 'INVALID_MESSAGE', 'Message is required');
  }
  const comment = service.addComment(req.taskId, message);
  res.status(201).json({ comment });
});

router.get('/', (req, res) => {
  const comments = service.getCommentsByTaskId(req.taskId);
  res.json({ comments });
});

module.exports = router;
