const express = require('express');
const taskService = require('./service');
const router = express.Router();

router.get('/', (req, res) => {
  const projectId = req.params.projectId;
  const tasks = taskService.getTasksByProjectId(projectId);
  res.json({ tasks });
});

router.post('/', (req, res, next) => {
  try {
    const task = taskService.createTask(req.params.projectId, req.body.title);
    res.status(201).json({ task });
  } catch (err) {
    next(err);
  }
});

router.patch('/:taskId', (req, res, next) => {
  try {
    const task = taskService.updateTask(req.params.projectId, req.params.taskId, req.body.status);
    res.json({ task });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
