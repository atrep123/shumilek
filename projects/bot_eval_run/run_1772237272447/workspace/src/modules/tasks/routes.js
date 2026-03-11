const express = require('express');
const router = express.Router();
const taskService = require('./service');

router.post('/:projectId/tasks', (req, res) => {
  const { projectId } = req.params;
  const { title } = req.body;
  if (!title) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Title is required' } });
  }
  const task = taskService.createTask(projectId, title);
  if (!task) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  }
  res.status(201).json({ task });
});

router.get('/:projectId/tasks', (req, res) => {
  const { projectId } = req.params;
  const tasks = taskService.getTasksByProjectId(projectId);
  if (!tasks) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  }
  res.json({ tasks });
});

router.patch('/:projectId/tasks/:taskId', (req, res) => {
  const { projectId, taskId } = req.params;
  const { status } = req.body;
  if (!status) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Status is required' } });
  }
  const task = taskService.updateTask(projectId, taskId, status);
  if (!task) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found' } });
  }
  res.json({ task });
});

router.get('/:projectId/tasks/:taskId/comments', (req, res) => {
  const { projectId, taskId } = req.params;
  const comments = taskService.getCommentsByTaskId(projectId, taskId);
  if (!comments) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found' } });
  }
  res.json({ comments });
});

module.exports = router;
