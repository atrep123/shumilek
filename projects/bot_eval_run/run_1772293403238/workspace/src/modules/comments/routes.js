const express = require('express');
const service = require('./service');
const { BadRequestError } = require('../../lib/errors');

const router = express.Router();

router.post('/', (req, res) => {
  const projectId = req.params.projectId;
  const taskId = req.params.taskId;
  const { content } = req.body;
  if (!content || typeof content !== 'string' || content.trim() === '') {
    throw new BadRequestError('Content is required');
  }
  const comment = service.addComment(projectId, taskId, content);
  res.status(201).json({ comment });
});

module.exports = router;
