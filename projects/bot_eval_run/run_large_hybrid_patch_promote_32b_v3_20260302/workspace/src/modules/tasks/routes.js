const express = require('express');
const service = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.get('/', (req, res) => {
  const { projectId } = req.params;
  const status = req.query.status;
  const tasks = service.getTasksByProjectId(projectId);
  if (!tasks) {
    return sendError(res, 404, 'NOT_FOUND', 'Project not found');
  }
  const filteredTasks = status ? tasks.filter(task => task.status === status) : tasks;
  res.json({ tasks: filteredTasks });
});

router.post('/', (req, res) => {
  const { projectId } = req.params;
  const task = service.createTask(projectId);
  if (!task) {
    return sendError(res, 404, 'NOT_FOUND', 'Project not found');
  }
  res.status(201).json({ task });
});

router.patch('/:taskId', (req, res) => {
  const { projectId, taskId } = req.params;
  const { status } = req.body;
  if (!status || !(status === 'todo' || status === 'done')) {
    return sendError(res, 400, 'BAD_REQUEST', 'Invalid status');
  }
  const task = service.updateTaskStatus(projectId, taskId, status);
  if (!task) {
    return sendError(res, 404, 'NOT_FOUND', 'Task not found');
  }
  res.json({ task });
});

module.exports = router;
