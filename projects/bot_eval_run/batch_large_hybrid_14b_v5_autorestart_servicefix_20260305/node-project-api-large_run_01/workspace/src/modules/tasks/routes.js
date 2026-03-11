const express = require('express');
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res) => {
  const status = req.query.status;
  try {
    const tasks = await tasksService.getAllTasks(req.params.projectId);
    if (status === 'todo' || status === 'done') {
      const doneTasks = tasks.filter(task => task.status === 'done');
      return res.json({ tasks: doneTasks });
    }
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

router.post('/', async (req, res) => {
  const { title } = req.body;
  if (!title) {
    return sendError(res, 400, 'INVALID_INPUT', 'Title is required');
  }
  try {
    const task = await tasksService.createTask(req.params.projectId, title);
    res.status(201).json({ task });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

router.patch('/:taskId', async (req, res) => {
  const { status } = req.body;
  if (!['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_INPUT', 'Invalid status');
  }
  try {
    const task = await tasksService.updateTaskStatus(req.params.taskId, status);
    if (!task) {
      return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
    }
    res.json({ task });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

module.exports = router;
