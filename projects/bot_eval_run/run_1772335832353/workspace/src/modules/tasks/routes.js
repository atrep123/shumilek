const express = require('express');
tasksService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router({ mergeParams: true });

router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return sendError(res, 400, 'INVALID_INPUT', 'Name is required');
  }

  const task = await tasksService.createTask(req.params.projectId, name);
  if (!task) {
    return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  res.status(201).json({ task });
});

router.get('/', async (req, res) => {
  const tasks = await tasksService.getAllTasks(req.params.projectId);
  if (!tasks) {
    return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  res.json({ tasks });
});

router.patch('/:taskId', async (req, res) => {
  const { status } = req.body;
  if (!status || !['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_INPUT', 'Status must be either todo or done');
  }

  const task = await tasksService.updateTask(req.params.projectId, req.params.taskId, status);
  if (!task) {
    return sendError(res, 404, 'PROJECT_OR_TASK_NOT_FOUND', 'Project or task not found');
  }

  res.json({ task });
});

module.exports = router;
