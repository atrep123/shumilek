const express = require('express');
const router = express.Router({ mergeParams: true });
const tasksService = require('./service');

router.post('/', async (req, res) => {
  const { title } = req.body;
  if (!title) return sendError(res, 400, 'MissingTitle', 'Task title is required');
  try {
    const task = await tasksService.createTask({ projectId: req.params.projectId, title });
    return res.status(201).json({ task });
  } catch (error) {
    throw error;
  }
});

router.patch('/:taskId', async (req, res) => {
  const { status } = req.body;
  if (!['todo', 'done'].includes(status)) return sendError(res, 400, 'InvalidStatus', 'Task status must be either todo or done');
  try {
    const task = await tasksService.updateTaskStatus({ projectId: req.params.projectId, taskId: req.params.taskId, status });
    return res.json({ task });
  } catch (error) {
    throw error;
  }
});

router.get('/', async (req, res) => {
  const { status } = req.query;
  try {
    const tasks = await tasksService.getTasksByStatus({ projectId: req.params.projectId, status });
    return res.json({ tasks });
  } catch (error) {
    throw error;
  }
});

module.exports = router;