const express = require('express');
const { createTask } = require('./service');
const router = express.Router({ mergeParams: true });

router.post('/', async (req, res) => {
  const task = await createTask(req.params.projectId, req.body);
  if (task) {
    res.status(201).json({ task });
  } else {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  }
});

module.exports = router;