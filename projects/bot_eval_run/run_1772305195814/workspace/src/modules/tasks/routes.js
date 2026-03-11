const express = require('express');
const router = express.Router();
const taskService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', (req, res) => {
  const tasks = taskService.getAllTasks(req.params.projectId);
  if (req.query.status) {
    return res.json({ tasks: tasks.filter(task => task.status === req.query.status) });
  }
  res.json({ tasks });
});

router.post('/', (req, res) => {
  const { title } = req.body;
  if (!title) {
    return sendError(res, 400, 'INVALID_TITLE', 'Title is required');
  }
  const task = taskService.createTask(req.params.projectId, title);
  res.status(201).json({ task });
});

router.patch('/:taskId', (req, res) => {
  const { status } = req.body;
  if (!status || !['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'Status must be either todo or done');
  }
  const task = taskService.updateTask(req.params.projectId, req.params.taskId, status);
  res.json({ task });
});

module.exports = router;
