const express = require('express');
const router = express.Router();
const service = require('./service');

router.get('/', (req, res) => {
  const { projectId } = req.params;
  const status = req.query.status;
  const tasks = service.getTasksByProjectId(projectId, status);
  if (!tasks || tasks.error) return res.status(tasks?.error.code || 500).json(tasks);
  res.json(tasks);
});

router.post('/', (req, res) => {
  const { projectId } = req.params;
  const data = req.body;
  const result = service.createTask(projectId, data);
  if (!result || result.error) return res.status(result?.error.code || 500).json(result);
  res.status(201).json(result);
});

router.patch('/:taskId', (req, res) => {
  const { projectId, taskId } = req.params;
  const data = req.body;
  const result = service.updateTaskStatus(projectId, taskId, data);
  if (!result || result.error) return res.status(result?.error.code || 500).json(result);
  res.json(result);
});

module.exports = router;
