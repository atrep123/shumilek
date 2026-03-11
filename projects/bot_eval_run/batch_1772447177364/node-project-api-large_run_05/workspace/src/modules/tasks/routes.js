// src/modules/tasks/routes.js
const express = require('express');
const { sendError } = require('../../lib/errors');
const tasksService = require('./service');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const status = req.query.status;
    const tasks = await tasksService.getTasksByProjectId(req.params.projectId, status);
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, description } = req.body;
    if (!title || typeof title !== 'string' || !description || typeof description !== 'string') {
      return sendError(res, 400, 'INVALID_INPUT', 'Invalid input');
    }
    const task = await tasksService.createTask(req.params.projectId, title, description);
    res.status(201).json({ task });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') {
      return sendError(res, 404, 'PROJECT_NOT_FOUND', error.message);
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.patch('/:taskId', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status || (status !== 'todo' && status !== 'done')) {
      return sendError(res, 400, 'INVALID_INPUT', 'Invalid input');
    }
    const task = await tasksService.updateTaskStatus(req.params.projectId, req.params.taskId, status);
    if (!task) {
      return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
    }
    res.json({ task });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND' || error.code === 'TASK_NOT_FOUND') {
      return sendError(res, 404, error.code, error.message);
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;