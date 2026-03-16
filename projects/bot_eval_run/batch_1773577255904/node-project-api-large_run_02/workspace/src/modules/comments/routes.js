const express = require('express');
const commentsService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router({ mergeParams: true });

router.post('/', (req, res) => {
  const { message } = req.body;
  if (!message) {
    return sendError(res, 400, 'BadRequest', 'Message is required');
  }
  const comment = commentsService.createComment(message);
  res.status(201).json({ comment });
});

router.get('/', (req, res) => {
  const comments = commentsService.getComments();
  res.json({ comments });
});

module.exports = router;
