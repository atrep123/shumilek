const express = require('express');
const { sendError } = require('../../lib/errors');
taskService = require('./service');

const router = express.Router();

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return sendError(res, 400, 'INVALID_INPUT', 'Task name is required');
  }

  const task = taskService.addTask(req.projectId, { name });
  res.status(201).json({ task });
});

router.get('/', (req, res) => {
  const status = req.query.status;
  const tasks = taskService.getTasks(req.projectId, status);
  res.json({ tasks });
});

module.exports = router;
