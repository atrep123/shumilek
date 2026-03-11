const express = require('express');
const router = express.Router();
const commentsService = require('./service');
const { sendError } = require('../../lib/errors');

router.post('/', (req, res) => {
  const { message } = req.body;
  if (!message) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'Payload must include message');
  }

  const comment = commentsService.createComment(req.projectId, req.taskId, { message });
  res.status(201).json({ comment });
});

router.get('/', (req, res) => {
  const comments = commentsService.getAllComments(req.projectId, req.taskId);
  res.json({ comments });
});

module.exports = router;
