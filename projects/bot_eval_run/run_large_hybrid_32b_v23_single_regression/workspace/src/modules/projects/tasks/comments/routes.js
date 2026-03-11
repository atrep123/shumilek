const express = require('express');
const service = require('./service');
const router = express.Router();

router.post('/', (req, res) => {
  const { projectId, taskId } = req.params;
  const { message } = req.body;
  if (!message) {
    return sendError(res, 400, 'invalid_input', 'Message is required');
  }
  const comment = service.addCommentToTask(projectId, taskId, message);
  if (!comment) {
    return sendError(res, 404, 'not_found', 'Task not found');
  }
  res.status(201).json({ comment });
});

module.exports = router;
