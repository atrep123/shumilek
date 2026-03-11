const express = require('express');
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  const { title } = req.body;
  if (!title) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'Title is required');
  }
  try {
    const task = await tasksService.createTask(req.params.projectId, title);
    res.status(201).json({ task });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create task');
  }
});

router.patch('/:taskId', async (req, res) => {
  const { status } = req.body;
  if (!['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'Status must be either todo or done');
  }
  try {
    const task = await tasksService.updateTask(req.params.projectId, req.params.taskId, status);
    if (!task) {
      return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
    }
    res.json({ task });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to update task');
  }
});

router.get('/', async (req, res) => {
  try {
    const tasks = await tasksService.getTasks(req.params.projectId);
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to get tasks');
  }
});

module.exports = router;
