const express = require('express');
const { createTask, getTasksByProjectId, updateTaskStatus } = require('./service');
const router = express.Router();

router.post('/:projectId/tasks', (req, res) => {
  try {
    const task = createTask(req.params.projectId, req.body);
    res.status(201).json({ task });
  } catch (error) {
    res.status(error.code).json({ error: { code: error.code, message: error.message } });
  }
});

router.get('/:projectId/tasks', (req, res) => {
  try {
    const tasks = getTasksByProjectId(req.params.projectId, req.query.status);
    res.json({ tasks });
  } catch (error) {
    res.status(error.code).json({ error: { code: error.code, message: error.message } });
  }
});

router.patch('/:projectId/tasks/:taskId', (req, res) => {
  try {
    const task = updateTaskStatus(req.params.projectId, req.params.taskId, req.body);
    res.json({ task });
  } catch (error) {
    res.status(error.code).json({ error: { code: error.code, message: error.message } });
  }
});

module.exports = router;
