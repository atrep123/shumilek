const express = require('express');
const commentsService = require('./service');

const router = express.Router();

router.post('/', async (req, res) => {
  const { projectId, taskId } = req.params;
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Message is required' } });
  }
  const comment = await commentsService.addComment(projectId, taskId, message);
  res.status(201).json({ comment });
});

module.exports = router;
