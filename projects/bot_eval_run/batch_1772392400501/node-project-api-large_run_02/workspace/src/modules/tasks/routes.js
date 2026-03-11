const express = require('express');
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  const { title } = req.body;
  if (!title) {
    return sendError(res, 400, 'INVALID_TITLE', 'Title is required');
  }
  try {
    const task = await tasksService.createTask(req.params.projectId, title);
    res.json({ task });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

router.get('/', async (req, res) => {
  const { status } = req.query;
  try {
    const tasks = await tasksService.getAllTasks(req.params.projectId, status);
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

router.patch('/:taskId', async (req, res) => {
  const { status } = req.body;
  if (!['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'Invalid task status');
  }
  try {
    const task = await tasksService.updateTaskStatus(req.params.projectId, req.params.taskId, status);
    res.json({ task });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

module.exports = router;