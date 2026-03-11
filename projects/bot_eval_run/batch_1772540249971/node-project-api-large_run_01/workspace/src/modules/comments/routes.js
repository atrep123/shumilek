const express = require('express');
const { BadRequestError, NotFoundError } = require('../../lib/errors');
const service = require('./service');

const router = express.Router({ mergeParams: true });

router.post('/', (req, res) => {
  const { message } = req.body;
  if (!message) {
    return sendError(res, 400, 'BAD_REQUEST', 'Invalid request body');
  }

  const comment = service.addComment(req.taskId, { message });
  if (!comment) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to add comment');
  }

  res.status(201).json({ comment });
});

router.get('/', (req, res) => {
  const comments = service.getComments(req.taskId);
  if (!comments) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch comments');
  }

  res.json({ comments });
});

module.exports = router;
