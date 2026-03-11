// src/modules/tasks/routes.js
const express = require('express');
const router = express.Router();
const tasksService = require('../service');
const { sendError } = require('../../lib/errors');

router.post('/', async (req, res) => {
  const { description } = req.body;
  if (!description || typeof description !== 'string' || description.trim() === '') {
    return sendError(res, 400, 'INVALID_DESCRIPTION', 'Description must be a non-empty string');
  }

  try {
    const task = await tasksService.addTask(req.params.projectId, { description });
    res.status(201).json({ task });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.get('/', async (req, res) => {
  const { status } = req.query;
  try {
    let tasks = await tasksService.getTasks(req.params.projectId);
    if (status === 'done') {
      tasks = tasks.filter(task => task.status === 'done');
    }
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.patch('/:taskId', async (req, res) => {
  const { status } = req.body;
  if (!['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'Status must be either todo or done');
  }

  try {
    const updatedTask = await tasksService.updateTask(req.params.projectId, req.params.taskId, { status });
    res.json({ task: updatedTask });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
