// src/modules/tasks/routes.js
const express = require('express');
const service = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  const { description } = req.body;
  if (!description) {
    return sendError(res, 400, 'INVALID_INPUT', 'Description is required');
  }
  try {
    const task = await service.createTask(description);
    res.status(201).json({ task });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create task');
  }
});

router.get('/', async (req, res) => {
  const { status } = req.query;
  try {
    const tasks = await service.getTasks(status);
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to get tasks');
  }
});

router.patch('/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const { status } = req.body;
  if (!['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_INPUT', 'Invalid task status');
  }
  try {
    const updatedTask = await service.updateTask(taskId, status);
    res.json({ task: updatedTask });
  } catch (error) {
    if (error.code === 'NOT_FOUND') {
      return sendError(res, 404, 'NOT_FOUND', 'Task not found');
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to update task');
  }
});

module.exports = router;