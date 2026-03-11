const express = require('express');
const service = require('./service');

const router = express.Router();

router.get('/', (req, res) => {
  const tasks = service.getAllTasks();
  res.json({ tasks });
});

router.post('/:projectId/tasks', (req, res) => {
  const task = service.createTask(req.params.projectId, req.body);
  if (!task) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  }
  res.status(201).json({ task });
});

router.get('/:projectId/tasks/:taskId', (req, res) => {
  const task = service.getTaskById(req.params.projectId, req.params.taskId);
  if (!task) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found' } });
  }
  res.json({ task });
});

router.patch('/:projectId/tasks/:taskId', (req, res) => {
  const task = service.updateTask(req.params.projectId, req.params.taskId, req.body);
  if (!task) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found' } });
  }
  res.json({ task });
});

module.exports = router;
