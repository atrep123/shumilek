// src/modules/tasks/routes.js
const express = require('express');
const router = express.Router();
const tasksService = require('../tasks/service');
const { sendError } = require('../../lib/errors');

router.get('/', async (req, res) => {
  const projectId = req.params.projectId;
  const statusFilter = req.query.status;
  try {
    const tasks = await tasksService.getTasks(projectId, statusFilter);
    if (!tasks) {
      return sendError(res, 404, 'NOT_FOUND', 'Project not found');
    }
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.patch('/:taskId', async (req, res) => {
  const projectId = req.params.projectId;
  const taskId = req.params.taskId;
  const { status } = req.body;
  if (!['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'Invalid task status');
  }
  try {
    const updatedTask = await tasksService.updateTaskStatus(projectId, taskId, status);
    if (!updatedTask) {
      return sendError(res, 404, 'NOT_FOUND', 'Task not found');
    }
    res.json({ task: updatedTask });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
