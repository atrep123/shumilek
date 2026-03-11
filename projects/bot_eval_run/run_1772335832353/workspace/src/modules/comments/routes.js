const express = require('express');
const commentsService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router({ mergeParams: true });

router.post('/', async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return sendError(res, 400, 'INVALID_INPUT', 'Message is required');
  }

  const comment = await commentsService.createComment(req.params.projectId, req.params.taskId, message);
  if (!comment) {
    return sendError(res, 404, 'PROJECT_OR_TASK_NOT_FOUND', 'Project or task not found');
  }

  res.status(201).json({ comment });
});

module.exports = router;
