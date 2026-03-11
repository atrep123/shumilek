const express = require('express');
const service = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', (req, res) => {
  const { projectId, taskId } = req.params;
  const { message } = req.body;
  if (!message) {
    return sendError(res, 400, 'invalid_input', 'Message is required');
  }
  const comment = service.addCommentToTask(projectId, taskId, message);
  res.status(201).json({ comment });
});

module.exports = router;
