const express = require('express');
const { addComment } = require('./service');
const router = express.Router({ mergeParams: true });

router.post('/', async (req, res) => {
  const comment = await addComment(req.params.projectId, req.params.taskId, req.body);
  if (comment) {
    res.status(201).json({ comment });
  } else {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found' } });
  }
});

module.exports = router;