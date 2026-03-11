const express = require('express');
const { addComment, getCommentsByTaskId } = require('./service');
const router = express.Router();

router.post('/:projectId/tasks/:taskId/comments', (req, res) => {
  try {
    const comment = addComment(req.params.projectId, req.params.taskId, req.body);
    res.status(201).json({ comment });
  } catch (error) {
    res.status(error.code).json({ error: { code: error.code, message: error.message } });
  }
});

router.get('/:projectId/tasks/:taskId/comments', (req, res) => {
  try {
    const comments = getCommentsByTaskId(req.params.projectId, req.params.taskId);
    res.json({ comments });
  } catch (error) {
    res.status(error.code).json({ error: { code: error.code, message: error.message } });
  }
});

module.exports = router;
