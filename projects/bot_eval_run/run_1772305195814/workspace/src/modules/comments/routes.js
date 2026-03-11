const express = require('express');
const router = express.Router();
const commentService = require('./service');
const { sendError } = require('../../lib/errors');

router.post('/', (req, res) => {
  const { message } = req.body;
  if (!message) {
    return sendError(res, 400, 'INVALID_MESSAGE', 'Message is required');
  }
  const comment = commentService.addComment(req.params.projectId, req.params.taskId, message);
  res.status(201).json({ comment });
});

router.get('/', (req, res) => {
  const comments = commentService.getAllComments(req.params.projectId, req.params.taskId);
  res.json({ comments });
});

module.exports = router;
