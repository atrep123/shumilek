const express = require('express');
const router = express.Router({ mergeParams: true });
const service = require('./service');

// Create a new task
router.post('/', async (req, res) => {
  const task = await service.createTask({ status: 'todo', projectId: req.params.projectId });
  res.status(201).json({ task });
});

// Update a task status
router.patch('/:taskId', async (req, res) => {
  const allowedStatuses = ['todo', 'done'];
  if (!allowedStatuses.includes(req.body.status)) return sendError(res, 400, 'InvalidStatus', 'Task status must be one of todo or done');
  const task = await service.updateTaskStatus({ taskId: req.params.taskId, newStatus: req.body.status });
  res.json({ task });
});

// Filter tasks by status
router.get('/', async (req, res) => {
  const tasks = await service.getTasksByStatus(req.query.status || 'todo');
  res.json({ tasks });
});

module.exports = router;
