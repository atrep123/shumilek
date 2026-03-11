const express = require('express');
const router = express.Router({ mergeParams: true });
const tasksService = require('./service').service;

router.post('/', (req, res) => {
  if (!req.body.name) return sendError(res, 400, 'BadRequestError', 'Name is required');
  const task = tasksService.createTask(req.params.projectId, { name: req.body.name });
  res.status(201).json({ task });
});

router.patch('/:taskId', (req, res) => {
  if (!['todo', 'done'].includes(req.body.status)) return sendError(res, 400, 'BadRequestError', 'Invalid status');
  const task = tasksService.updateTaskStatus(req.params.projectId, req.params.taskId, req.body.status);
  if (!task) return sendError(res, 404, 'NotFoundError', 'Task not found');
  res.json({ task });
});

router.get('/', (req, res) => {
  const tasks = tasksService.getTasksByProjectId(req.params.projectId);
  if (!tasks) return sendError(res, 404, 'NotFoundError', 'Project not found');
  const filteredTasks = tasks.filter(task => task.status === 'done');
  res.json({ tasks: filteredTasks });
});

module.exports = { router };
