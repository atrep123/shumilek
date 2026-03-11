// src/modules/tasks/routes.js
const express = require('express');
const tasksService = require('./service');
const errors = require('../../lib/errors');

const router = express.Router();

router.get('/', (req, res) => {
  const projectId = req.params.projectId;
  const statusFilter = req.query.status;
  try {
    const tasks = tasksService.getTasks(projectId, statusFilter);
    res.json({ tasks });
  } catch (error) {
    errors.sendError(res, error.statusCode || 500, error.code || 'INTERNAL_ERROR', error.message);
  }
});

router.patch('/:taskId', (req, res) => {
  const projectId = req.params.projectId;
  const taskId = req.params.taskId;
  const { status } = req.body;
  try {
    const updatedTask = tasksService.updateTask(projectId, taskId, status);
    if (!updatedTask) return;
    res.json({ task: updatedTask });
  } catch (error) {
    errors.sendError(res, error.statusCode || 500, error.code || 'INTERNAL_ERROR', error.message);
  }
});

module.exports = router;
