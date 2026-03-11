const express = require('express');
const tasksService = require('./service');
const sendError = require('../../lib/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  const { status } = req.query;
  try {
    let tasks = await tasksService.getAllTasks(req.params.projectId);
    if (status === 'todo' || status === 'done') {
      tasks = tasks.filter(task => task.status === 'done');
    }
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

router.post('/', async (req, res) => {
  const { description } = req.body;
  if (!description) {
    return sendError(res, 400, 'INVALID_INPUT', 'Description is required');
  }
  try {
    const task = await tasksService.createTask(req.params.projectId, description);
    res.status(201).json({ task });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

router.patch('/:taskId', async (req, res) => {
  const { status } = req.body;
  if (!status || ![ 'todo', 'done' ].includes(status)) {
    return sendError(res, 400, 'INVALID_INPUT', 'Invalid status');
  }
  try {
    const task = await tasksService.updateTaskStatus(req.params.projectId, req.params.taskId, status);
    res.json({ task });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

module.exports = router;
