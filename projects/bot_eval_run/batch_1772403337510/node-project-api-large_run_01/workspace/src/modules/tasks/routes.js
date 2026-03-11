// src/modules/tasks/routes.js
const express = require('express');
const router = express.Router();
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', async (req, res) => {
  const projectId = req.params.projectId;
  const status = req.query.status;
  try {
    const tasks = await tasksService.getTasks(projectId, status);
    res.json({ tasks });
  } catch (error) {
    sendError(res, error.statusCode || 500, error.code || 'INTERNAL_ERROR', error.message);
  }
});

router.patch('/:taskId', async (req, res) => {
  const projectId = req.params.projectId;
  const taskId = req.params.taskId;
  const { status } = req.body;
  try {
    const task = await tasksService.updateTaskStatus(projectId, taskId, status);
    if (!task) {
      return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
    }
    res.json({ task });
  } catch (error) {
    sendError(res, error.statusCode || 500, error.code || 'INTERNAL_ERROR', error.message);
  }
});

module.exports = router;
