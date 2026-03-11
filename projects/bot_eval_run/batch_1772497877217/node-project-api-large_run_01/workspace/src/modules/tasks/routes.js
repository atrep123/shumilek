// src/modules/tasks/routes.js
const express = require('express');
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  const { status = 'todo' } = req.body;
  if (!['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_INPUT', 'Invalid task status');
  }
  const task = await tasksService.createTask(req.params.projectId, status);
  res.status(201).json({ task });
});

router.get('/', async (req, res) => {
  const { status } = req.query;
  if (status && !['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_INPUT', 'Invalid query parameter');
  }
  const tasks = await tasksService.getTasksByProjectId(req.params.projectId);
  if (status) {
    const filteredTasks = tasks.filter(task => task.status === status);
    res.json({ tasks: filteredTasks });
  } else {
    res.json({ tasks });
  }
});

router.patch('/:taskId', async (req, res) => {
  const { status } = req.body;
  if (!['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_INPUT', 'Invalid task status');
  }
  const updatedTask = await tasksService.updateTaskStatus(req.params.projectId, req.params.taskId, status);
  if (!updatedTask) {
    return sendError(res, 404, 'NOT_FOUND', 'Task not found');
  }
  res.json({ task: updatedTask });
});

module.exports = router;