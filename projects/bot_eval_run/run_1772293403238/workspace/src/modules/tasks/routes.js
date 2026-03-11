const express = require('express');
const service = require('./service');
const { BadRequestError } = require('../../lib/errors');

const router = express.Router();

router.get('/', (req, res) => {
  const projectId = req.params.projectId;
  let tasks = service.getAllTasks(projectId);
  if (req.query.status === 'done') {
    tasks = tasks.filter(task => task.status === 'done');
  }
  res.json({ tasks });
});

router.post('/', (req, res) => {
  const projectId = req.params.projectId;
  const { title } = req.body;
  if (!title || typeof title !== 'string' || title.trim() === '') {
    throw new BadRequestError('Title is required');
  }
  const task = service.createTask(projectId, title);
  res.status(201).json({ task });
});

module.exports = router;
