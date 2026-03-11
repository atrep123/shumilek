const express = require('express');
const service = require('./service');

const router = express.Router();

router.post('/:projectId', (req, res) => {
  try {
    const task = service.createTask(req.params.projectId, req.body.title);
    res.status(201).json({ task });
  } catch (error) {
    res.status(error.code === 'not_found' ? 404 : 400).json({ error: { code: error.code, message: error.message } });
  }
});

router.get('/:projectId', (req, res) => {
  const tasks = service.getTasksByProjectId(req.params.projectId);
  res.json({ tasks });
});

router.patch('/:projectId/:taskId', (req, res) => {
  try {
    const task = service.updateTaskStatus(req.params.projectId, req.params.taskId, req.body.status);
    res.json({ task });
  } catch (error) {
    res.status(error.code === 'not_found' ? 404 : 400).json({ error: { code: error.code, message: error.message } });
  }
});

module.exports = router;
