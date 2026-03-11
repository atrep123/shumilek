// src/modules/tasks/routes.js
const express = require('express');
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  const status = req.query.status;
  try {
    const tasks = await tasksService.getTasksByProjectId(req.params.projectId, status);
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.post('/', async (req, res) => {
  const { description } = req.body;
  if (!description || typeof description !== 'string' || description.trim() === '') {
    sendError(res, 400, 'INVALID_DESCRIPTION', 'Description must be a non-empty string');
    return;
  }

  try {
    const task = await tasksService.createTask(req.params.projectId, description);
    res.status(201).json({ task });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.patch('/:taskId', async (req, res) => {
  const { status } = req.body;
  if (!status || (status !== 'todo' && status !== 'done')) {
    sendError(res, 400, 'INVALID_STATUS', 'Invalid status');
    return;
  }

  try {
    const updatedTask = await tasksService.updateTaskStatus(req.params.projectId, req.params.taskId, status);
    if (!updatedTask) {
      sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
      return;
    }
    res.json({ task: updatedTask });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
