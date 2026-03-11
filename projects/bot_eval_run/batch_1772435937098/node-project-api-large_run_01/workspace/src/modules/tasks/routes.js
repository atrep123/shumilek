const express = require('express');
const tasksService = require('./service');
const sendError = require('../../lib/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  const { status } = req.query;
  try {
    const tasks = await tasksService.getAllTasks(req.params.projectId);
    if (status === 'done') {
      const doneTasks = tasks.filter(task => task.status === 'done');
      return res.json({ tasks: doneTasks });
    }
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
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
    if (error.code === 'PROJECT_NOT_FOUND') {
      sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    } else {
      sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
  }
});

module.exports = router;
