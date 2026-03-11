// src/modules/tasks/routes.js
const express = require('express');
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

// Get all tasks for a project
router.get('/', async (req, res) => {
  const { status } = req.query;
  try {
    let tasks = await tasksService.getAllTasks(req.params.projectId);
    if (status === 'done') {
      tasks = tasks.filter(task => task.status === 'done');
    }
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

// Create a new task for a project
router.post('/', async (req, res) => {
  const { title } = req.body;
  if (!title || typeof title !== 'string' || title.trim() === '') {
    return sendError(res, 400, 'INVALID_TITLE', 'Invalid task title');
  }
  try {
    const newTask = await tasksService.createTask(req.params.projectId, title);
    res.status(201).json({ task: newTask });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

// Update a task status
router.patch('/:taskId', async (req, res) => {
  const { status } = req.body;
  if (!status || typeof status !== 'string' || ![ 'todo', 'done' ].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'Invalid task status');
  }
  try {
    const updatedTask = await tasksService.updateTaskStatus(req.params.projectId, req.params.taskId, status);
    if (!updatedTask) {
      return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
    }
    res.json({ task: updatedTask });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
