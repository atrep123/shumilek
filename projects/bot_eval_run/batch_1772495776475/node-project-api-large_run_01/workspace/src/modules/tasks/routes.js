// src/modules/tasks/routes.js
const express = require('express');
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  const { title } = req.body;
  if (!title) {
    return sendError(res, 400, 'INVALID_INPUT', 'Title is required');
  }
  const task = await tasksService.createTask(req.params.projectId, title);
  res.status(201).json({ task });
});

router.get('/', async (req, res) => {
  const status = req.query.status;
  let tasks = await tasksService.getTasksByProjectId(req.params.projectId);
  if (status === 'todo' || status === 'done') {
    tasks = tasks.filter(task => task.status === status);
  }
  res.json({ tasks });
});

router.patch('/:taskId', async (req, res) => {
  const { status } = req.body;
  if (!['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_INPUT', 'Invalid task status');
  }
  const task = await tasksService.updateTaskStatus(req.params.projectId, req.params.taskId, status);
  if (!task) {
    return sendError(res, 404, 'NOT_FOUND', 'Task not found');
  }
  res.json({ task });
});

module.exports = router;
