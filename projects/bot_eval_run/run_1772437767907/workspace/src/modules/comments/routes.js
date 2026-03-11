const express = require('express');
const router = express.Router();
const commentsService = require('./service').service;
router.post('/', (req, res) => {
  if (!req.body.message) return sendError(res, 400, 'BAD_REQUEST', 'Message is required');
  const comment = commentsService.addComment(req.params.projectId, req.params.taskId, { message: req.body.message });
  res.status(201).json({ comment });
});
module.exports = { router };
