const express = require('express');
const taskService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', (req, res) => {
  const projectId = req.params.projectId;
  const task = taskService.createTask(projectId);
  if (!task) {
    return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  }
  res.status(201).json({ task });
});

router.get('/', (req, res) => {
  const projectId = req.params.projectId;
  const status = req.query.status;
  const tasks = taskService.getTasks(projectId, status);
  if (!tasks) {
    return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  }
  res.json({ tasks });
});

router.patch('/:taskId', (req, res) => {
  const projectId = req.params.projectId;
  const taskId = req.params.taskId;
  const { status } = req.body;
  const task = taskService.updateTaskStatus(projectId, taskId, status);
  if (!task) {
    return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
  }
  res.json({ task });
});

module.exports = router;
