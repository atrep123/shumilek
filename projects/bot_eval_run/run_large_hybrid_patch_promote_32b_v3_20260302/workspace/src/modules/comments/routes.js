const express = require('express');
const service = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', (req, res) => {
  const { projectId, taskId } = req.params;
  const { message } = req.body;
  if (!message) {
    return sendError(res, 400, 'BAD_REQUEST', 'Message is required');
  }
  const comment = service.addComment(projectId, taskId, message);
  if (!comment) {
    return sendError(res, 404, 'NOT_FOUND', 'Task not found');
  }
  res.status(201).json({ comment });
});

module.exports = router;
