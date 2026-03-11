const express = require('express');
const { addComment, listComments } = require('./service');

const router = express.Router();

// Add a comment to a task
router.post('/', async (req, res) => {
  try {
    const comment = await addComment(req.params.projectId, req.params.taskId, req.body);
    res.status(201).json(comment);
  } catch (error) {
    res.status(400).json({ error: { code: 'INVALID_INPUT', message: error.message } });
  }
});

// List all comments of a task
router.get('/', async (req, res) => {
  try {
    const comments = await listComments(req.params.projectId, req.params.taskId);
    res.json(comments);
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

module.exports = router;