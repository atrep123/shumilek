// src/modules/tasks/routes.js
const express = require('express');
const router = express.Router();
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', async (req, res) => {
  const projectId = req.params.projectId;
  try {
    const tasks = await tasksService.getAllTasks(projectId);
    res.json({ tasks });
  } catch (error) {
    sendError(res, error.status || 500, error.code || 'INTERNAL_ERROR', error.message);
  }
});

router.get('/:taskId/comments', async (req, res) => {
  const projectId = req.params.projectId;
  const taskId = req.params.taskId;
  try {
    const comments = await tasksService.getCommentsForTask(projectId, taskId);
    res.json({ comments });
  } catch (error) {
    sendError(res, error.status || 500, error.code || 'INTERNAL_ERROR', error.message);
  }
});

router.post('/', async (req, res) => {
  const projectId = req.params.projectId;
  const { title, description } = req.body;
  try {
    const task = await tasksService.createTask(projectId, title, description);
    res.status(201).json({ task });
  } catch (error) {
    sendError(res, error.status || 500, error.code || 'INTERNAL_ERROR', error.message);
  }
});

router.patch('/:taskId', async (req, res) => {
  const projectId = req.params.projectId;
  const taskId = req.params.taskId;
  const { status } = req.body;
  try {
    const updatedTask = await tasksService.updateTaskStatus(projectId, taskId, status);
    res.json({ task: updatedTask });
  } catch (error) {
    sendError(res, error.status || 500, error.code || 'INTERNAL_ERROR', error.message);
  }
});

module.exports = router;
