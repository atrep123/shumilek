const express = require('express');
const service = require('./service');
const { BadRequestError, NotFoundError } = require('../../lib/errors');

const router = express.Router();

router.post('/', (req, res) => {
  const projectId = req.params.projectId;
  const { title } = req.body;
  if (!title) {
    throw new BadRequestError('Title is required');
  }
  const task = service.createTask(projectId, title);
  res.status(201).json({ task });
});

router.get('/', (req, res) => {
  const projectId = req.params.projectId;
  const status = req.query.status;
  const tasks = service.getTasks(projectId, status);
  res.json({ tasks });
});

router.patch('/:taskId', (req, res) => {
  const { taskId } = req.params;
  const { status } = req.body;
  if (!status || !['done', 'pending'].includes(status)) {
    throw new BadRequestError('Invalid status');
  }
  const task = service.updateTaskStatus(taskId, status);
  res.json({ task });
});

module.exports = router;
