const express = require('express');
const commentsService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  const { content } = req.body;
  if (!content) {
    return sendError(res, 400, 'INVALID_CONTENT', 'Content is required');
  }
  try {
    const comment = await commentsService.addComment(req.params.projectId, req.params.taskId, content);
    res.json({ comment });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

router.get('/', async (req, res) => {
  try {
    const comments = await commentsService.getAllComments(req.params.projectId, req.params.taskId);
    res.json({ comments });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

module.exports = router;