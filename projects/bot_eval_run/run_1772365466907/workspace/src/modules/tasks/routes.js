const express = require('express');
const { sendError } = require('../../lib/errors');
const taskService = require('./service');

const router = express.Router();

router.post('/', (req, res) => {
  const projectId = req.params.projectId;
  const task = taskService.addTask(projectId);
  if (!task) return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');

  res.status(201).json({ task });
});

router.get('/', (req, res) => {
  const projectId = req.params.projectId;
  let tasks = taskService.getTasksByProject(projectId);
  if (!tasks) return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');

  const status = req.query.status;
  if (status === 'done') {
    tasks = tasks.filter(t => t.status === 'done');
  }

  res.json({ tasks });
});

router.patch('/:taskId', (req, res) => {
  const projectId = req.params.projectId;
  const taskId = req.params.taskId;
  const { status } = req.body;
  if (!status || !['todo', 'done'].includes(status)) return sendError(res, 400, 'INVALID_STATUS', 'Status must be either todo or done');

  const task = taskService.updateTaskStatus(projectId, taskId, status);
  if (!task) return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');

  res.json({ task });
});

module.exports = router;
