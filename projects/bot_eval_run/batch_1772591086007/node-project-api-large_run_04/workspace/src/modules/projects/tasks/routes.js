const express = require('express');
const service = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', (req, res) => {
  const { projectId } = req.params;
  const { title } = req.body;
  if (!title) {
    return sendError(res, 400, 'invalid_input', 'Title is required');
  }
  const task = service.createTask(projectId, title);
  res.status(201).json({ task });
});

router.get('/', (req, res) => {
  const { projectId } = req.params;
  const { status } = req.query;
  const tasks = service.getTasksByProjectId(projectId, status);
  res.json({ tasks });
});

module.exports = router;
