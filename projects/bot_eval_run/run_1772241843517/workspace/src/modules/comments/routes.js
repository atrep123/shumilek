const express = require('express');
const service = require('./service');

const router = express.Router();

router.post('/:projectId/:taskId', (req, res) => {
  try {
    const comment = service.addComment(req.params.projectId, req.params.taskId, req.body.message);
    res.status(201).json({ comment });
  } catch (error) {
    res.status(error.code === 'not_found' ? 404 : 400).json({ error: { code: error.code, message: error.message } });
  }
});

router.get('/:projectId/:taskId', (req, res) => {
  const comments = service.getCommentsByTaskId(req.params.projectId, req.params.taskId);
  res.json({ comments });
});

module.exports = router;
