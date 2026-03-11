const express = require('express');
const commentService = require('./service');
const router = express.Router();

router.get('/', (req, res) => {
  const taskId = req.params.taskId;
  const comments = commentService.getCommentsByTaskId(taskId);
  res.json({ comments });
});

router.post('/', (req, res, next) => {
  try {
    const comment = commentService.addComment(req.params.projectId, req.params.taskId, req.body.message);
    res.status(201).json({ comment });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
