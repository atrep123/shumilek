// src/modules/tasks/routes.js
const express = require('express');
const router = express.Router();
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', async (req, res) => {
  const projectId = req.params.projectId;
  try {
    let tasks = await tasksService.getAllTasks(projectId);
    if (req.query.status === 'done') {
      tasks = tasks.filter(task => task.status === 'done');
    }
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.post('/', async (req, res) => {
  const projectId = req.params.projectId;
  const { title } = req.body;
  if (!title || typeof title !== 'string' || title.trim() === '') {
    return sendError(res, 400, 'INVALID_TITLE', 'Title must be a non-empty string');
  }

  try {
    const task = await tasksService.createTask(projectId, title);
    res.status(201).json({ task });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.patch('/:taskId', async (req, res) => {
  const projectId = req.params.projectId;
  const taskId = req.params.taskId;
  const { status } = req.body;
  if (!['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'Status must be either 