const express = require('express');
const router = express.Router();
const commentService = require('./service');

router.get('/:projectId/tasks/:taskId/comments', (req, res) => {
  try {
    const comments = commentService.getCommentsByTaskId(req.params.projectId, req.params.taskId);
    res.status(200).json({ comments });
  } catch (error) {
    res.status(404).json({ error: { code: 'not_found', message: error.message } });
  }
});

router.post('/:projectId/tasks/:taskId/comments', (req, res) => {
  try {
    const comment = commentService.createComment(req.params.projectId, req.params.taskId, req.body.message);
    res.status(201).json({ comment });
  } catch (error) {
    res.status(error.code === 'not_found' ? 404 : 400).json({ error: { code: error.code, message: error.message } });
  }
});

module.exports = (app) => app.use('/projects', router);
