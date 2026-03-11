const express = require('express');
const service = require('./service');
const { sendError, errorHandler } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const comment = await service.addComment(req.params.projectId, req.params.taskId, req.body);
    if (!comment) return sendError(res, 409, 'COMMENT_DUPLICATE', 'Comment already exists');
    res.status(201).json({ comment });
  } catch (error) {
    errorHandler(res, error);
  }
});

router.get('/', async (req, res) => {
  try {
    const comments = await service.getAllComments(req.params.projectId, req.params.taskId);
    if (!comments) return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
    res.status(200).json({ comments });
  } catch (error) {
    errorHandler(res, error);
  }
});

module.exports = router;
