const express = require('express');
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const tasks = await tasksService.getTasks(req.params.projectId);
    if (req.query.status === 'done') {
      const doneTasks = tasks.filter(task => task.status === 'done');
      return res.json({ tasks: doneTasks });
    }
    res.json({ tasks });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') {
      return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

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

router.patch('/:taskId', async (req, res) => {
  const { status } = req.body;
  if (!status || typeof status !== 'string' || ![ 'todo', 'done' ].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'Status must be either 