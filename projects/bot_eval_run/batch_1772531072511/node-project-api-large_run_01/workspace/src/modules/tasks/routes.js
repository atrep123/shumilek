const express = require('express');
const { sendError } = require('../../lib/errors');
const taskService = require('./service');

const router = express.Router();

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'Name is required');
  }
  const task = taskService.createTask(req.projectId, name);
  res.status(201).json({ task });
});

router.patch('/:taskId', (req, res) => {
  const { status } = req.body;
  if (!status || !['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'Status must be either todo or done');
  }
  const task = taskService.updateTask(req.projectId, req.params.taskId, status);
  if (!task) {
    return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
  }
  res.json({ task });
});

router.get('/', (req, res) => {
  const { status } = req.query;
  let tasks = projectService.getProjectById(req.projectId).tasks;
  if (status && ['todo', 'done'].includes(status)) {
    tasks = tasks.filter(task => task.status === status);
  }
  res.json({ tasks });
});

module.exports = router;
