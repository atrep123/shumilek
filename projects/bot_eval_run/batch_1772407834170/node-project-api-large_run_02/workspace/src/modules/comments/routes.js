// src/modules/comments/routes.js
const express = require('express');
const router = express.Router();
const commentsService = require('./service');
const { sendError } = require('../../lib/errors');

router.post('/', async (req, res) => {
  const projectId = req.params.projectId;
  const taskId = req.params.taskId;
  const { message } = req.body;
  try {
    const comment = await commentsService.createComment(projectId, taskId, message);
    res.status(201).json({ comment });
  } catch (error) {
    sendError(res, error.status || 500, error.code || 'INTERNAL_ERROR', error.message);
  }
});

module.exports = router;
