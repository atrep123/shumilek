const express = require('express');
const router = express.Router();
const commentService = require('./service');

router.get('/:projectId/tasks/:taskId/comments', (req, res) => {
  try {
    const comments = commentService.getAllCommentsByTaskId(req.params.projectId, req.params.taskId);
    res.status(200).json({ comments });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: { code: error.code, message: error.message } });
  }
});

router.post('/:projectId/tasks/:taskId/comments', (req, res) => {
  try {
    const comment = commentService.createComment(req.params.projectId, req.params.taskId, req.body.text);
    res.status(201).json({ comment });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: { code: error.code, message: error.message } });
  }
});

module.exports = (app) => app.use('/projects', router);
