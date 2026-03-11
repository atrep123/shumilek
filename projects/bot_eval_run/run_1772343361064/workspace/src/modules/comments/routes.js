const express = require('express');
const commentsService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router({ mergeParams: true });

router.post('/', (req, res) => {
  const { message } = req.body;
  if (!message) {
    return sendError(res, 400, 'BAD_REQUEST', 'Message is required');
  }

  const comment = commentsService.createComment(req.params.projectId, req.params.taskId, message);
  if (!comment) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create comment');
  }

  res.status(201).json({ comment });
});

router.get('/', (req, res) => {
  const comments = commentsService.getComments(req.params.projectId, req.params.taskId);
  if (!comments) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch comments');
  }

  res.json({ comments });
});

module.exports = router;
