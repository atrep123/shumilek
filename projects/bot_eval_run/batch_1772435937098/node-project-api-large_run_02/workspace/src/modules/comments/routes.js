const express = require('express');
const commentsService = require('./service');
const sendError = require('../../lib/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const comments = await commentsService.getAllComments(req.params.projectId, req.params.taskId);
    res.json({ comments });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.post('/', async (req, res) => {
  const { content } = req.body;
  if (!content) {
    return sendError(res, 400, 'INVALID_INPUT', 'Content is required');
  }
  try {
    const comment = await commentsService.addComment(req.params.projectId, req.params.taskId, content);
    res.status(201).json({ comment });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND' || error.code === 'TASK_NOT_FOUND') {
      sendError(res, 404, 'NOT_FOUND', 'Project or task not found');
    } else {
      sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
  }
});

module.exports = router;
