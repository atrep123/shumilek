// src/modules/tasks/routes.js
const express = require('express');
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) {
      return sendError(res, 400, 'INVALID_INPUT', 'Title is required');
    }
    const task = await tasksService.createTask(req.params.projectId, description);
    res.status(201).json({ task });
  } catch (error) {
    if (error.code === 'DUPLICATE') {
      return sendError(res, 409, 'DUPLICATE', 'Task already exists');
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.get('/', async (req, res) => {
  try {
    const status = req.query.status;
    let tasks = await tasksService.getTasksByProjectId(req.params.projectId);
    if (status === 'todo' || status === 'done') {
      tasks = tasks.filter(task => task.status === 'done');
    }
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.patch('/:taskId', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['todo', 'done'].includes(status)) {
      return sendError(res, 400, 'INVALID_INPUT', 'Invalid task status');
    }
    const updatedTask = await tasksService.updateTaskStatus(req.params.projectId, req.params.taskId, status);
    if (!updatedTask) {
      return sendError(res, 404, 'NOT_FOUND', 'Task not found');
    }
    res.json({ task: updatedTask });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
