// src/modules/tasks/routes.js
const express = require('express');
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

// Create a task
router.post('/', async (req, res) => {
  const { title } = req.body;
  if (!title || typeof title !== 'string' || title.trim() === '') {
    return sendError(res, 400, 'INVALID_TITLE', 'Title must be a non-empty string');
  }

  try {
    const task = await tasksService.createTask(req.params.projectId, title);
    res.status(201).json({ task });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

// Update a task status
router.patch('/:taskId', async (req, res) => {
  const { status } = req.body;
  if (!status || typeof status !== 'string' || ![ 'todo', 'done' ].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'Invalid status');
  }

  try {
    const task = await tasksService.updateTaskStatus(req.params.projectId, req.params.taskId, status);
    res.json({ task });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

// Get all tasks with optional filter by status
router.get('/', async (req, res) => {
  const { status } = req.query;

  try {
    const tasks = await tasksService.getAllTasks(req.params.projectId, status);
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
