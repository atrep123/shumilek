const express = require('express');
const service = require('./service');
const { BadRequestError, NotFoundError } = require('../../lib/errors');

const router = express.Router();

router.post('/', (req, res) => {
  const taskId = req.params.taskId;
  const { message } = req.body;
  if (!message) {
    throw new BadRequestError('Message is required');
  }
  const comment = service.addComment(taskId, message);
  res.status(201).json({ comment });
});

router.get('/', (req, res) => {
  const taskId = req.params.taskId;
  const comments = service.getComments(taskId);
  res.json({ comments });
});

module.exports = router;
