// src/modules/tasks/routes.js
const express = require('express');
const { sendError } = require('../../lib/errors');
const tasksService = require('./service');

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
    if (error.code === 'PROJECT_NOT_FOUND') {
      return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

// Get tasks by status
router.get('/', async (req, res) => {
  const { status } = req.query;
  try {
    const tasks = await tasksService.getTasksByStatus(req.params.projectId, status);
    res.json({ tasks });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') {
      return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

// Update task status
router.patch('/:taskId', async (req, res) => {
  const { status } = req.body;
  if (!status || typeof status !== 'string' || ![ 'todo', 'done' ].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'Invalid status');
  }

  try {
    const task = await tasksService.updateTaskStatus(req.params.projectId, req.params.taskId, status);
    res.json({ task });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') {
      return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    }
    if (error.code === 'TASK_NOT_FOUND') {
      return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
