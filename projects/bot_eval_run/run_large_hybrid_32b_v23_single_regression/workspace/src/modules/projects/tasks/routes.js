const express = require('express');
const service = require('./service');
const router = express.Router();

router.post('/', (req, res) => {
  const { projectId } = req.params;
  const task = service.createTask(projectId);
  if (!task) {
    return sendError(res, 404, 'not_found', 'Project not found');
  }
  res.status(201).json({ task });
});

router.get('/', (req, res) => {
  const { projectId } = req.params;
  const status = req.query.status;
  const tasks = service.getTasksByProjectId(projectId, status);
  if (!tasks) {
    return sendError(res, 404, 'not_found', 'Project not found');
  }
  res.json({ tasks });
});

router.patch('/:taskId', (req, res) => {
  const { projectId, taskId } = req.params;
  const { status } = req.body;
  if (!['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'invalid_input', 'Status must be todo or done');
  }
  const task = service.updateTaskStatus(projectId, taskId, status);
  if (!task) {
    return sendError(res, 404, 'not_found', 'Task not found');
  }
  res.json({ task });
});

module.exports = router;
