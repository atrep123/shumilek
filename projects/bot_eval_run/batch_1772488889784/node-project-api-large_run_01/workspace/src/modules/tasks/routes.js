// src/modules/tasks/routes.js
const express = require('express');
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  const { description } = req.body;
  if (!description) {
    return sendError(res, 400, 'INVALID_DESCRIPTION', 'Invalid task description');
  }
  try {
    const task = await tasksService.createTask(description);
    res.status(201).json({ task });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.get('/', async (req, res) => {
  const { status } = req.query;
  try {
    const tasks = await tasksService.getTasks(status);
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.patch('/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const { status } = req.body;
  if (!status || ![ 'todo', 'done' ].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'Invalid task status');
  }
  try {
    const updatedTask = await tasksService.updateTask(taskId, status);
    res.json({ task: updatedTask });
  } catch (error) {
    if (error.code === 'NOT_FOUND') {
      return sendError(res, 404, error.code, error.message);
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
