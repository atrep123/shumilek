// src/modules/tasks/routes.js
const express = require('express');
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { title } = req.body;
    if (!description || typeof description !== 'string') {
      return sendError(res, 400, 'INVALID_DESCRIPTION', 'Invalid task description');
    }
    const newTask = await tasksService.createTask(req.params.projectId, title);
    res.status(201).json({ task: newTask });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    let tasks = await tasksService.getTasksByProjectId(req.params.projectId);
    if (status === 'todo' || status === 'done') {
      tasks = tasks.filter(task => task.status === status);
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
      return sendError(res, 400, 'INVALID_STATUS', 'Invalid task status');
    }
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
