const express = require('express');
const commentsService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'Message is required');
  }
  try {
    const comment = await commentsService.createComment(req.params.taskId, message);
    res.status(201).json({ comment });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create comment');
  }
});

router.get('/', async (req, res) => {
  try {
    const comments = await commentsService.getComments(req.params.taskId);
    res.json({ comments });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to get comments');
  }
});

module.exports = router;
