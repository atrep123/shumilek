const express = require('express');
const { sendError } = require('../../lib/errors');
const taskService = require('./service');

const router = express.Router();

router.get('/', (req, res) => {
  const projectId = req.projectId;
  let tasks = taskService.getAllTasks(projectId);

  if (req.query.status) {
    tasks = tasks.filter(task => task.status === req.query.status);
  }

  res.json({ tasks });
});

router.post('/', (req, res) => {
  const projectId = req.projectId;
  const { title } = req.body;
  if (!title || typeof title !== 'string' || title.trim() === '') {
    return sendError(res, 400, 'INVALID_TITLE', 'Title must be a non-empty string');
  }

  const task = taskService.createTask(projectId, title);
  res.status(201).json({ task });
});

router.patch('/:taskId', (req, res) => {
  const projectId = req.projectId;
  const { taskId } = req.params;
  const { status } = req.body;
  if (!status || !['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'Status must be either todo or done');
  }

  const task = taskService.updateTask(projectId, taskId, status);
  if (!task) {
    return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
  }

  res.json({ task });
});

module.exports = router;
