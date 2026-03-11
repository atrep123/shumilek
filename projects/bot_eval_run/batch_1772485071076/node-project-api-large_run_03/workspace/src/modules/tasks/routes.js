// src/modules/tasks/routes.js
const express = require('express');
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  const status = req.query.status;
  try {
    let tasks;
    if (status === 'todo' || status === 'done') {
      tasks = await tasksService.getTasksByStatus(req.params.projectId, status);
    } else {
      tasks = await tasksService.getAllTasks(req.params.projectId);
    }
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.post('/', async (req, res) => {
  const { description } = req.body;
  if (!description || typeof description !== 'string' || description.trim() === '') {
    return sendError(res, 400, 'INVALID_DESCRIPTION', 'Description must be a non-empty string');
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
  if (!['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'Status must be either 