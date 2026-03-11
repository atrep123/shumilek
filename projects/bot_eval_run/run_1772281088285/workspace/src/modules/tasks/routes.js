const express = require('express');
const service = require('./service');
const { createError } = require('../../lib/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const tasks = await service.getAllTasks(req.params.projectId);
    if (!tasks) {
      return res.status(404).json(createError('not_found', 'Project not found'));
    }
    res.status(200).json({ tasks });
  } catch (error) {
    res.status(500).json(createError('internal_error', 'Internal server error'));
  }
});

router.post('/', async (req, res) => {
  try {
    const task = await service.createTask(req.params.projectId, req.body);
    if (!task) {
      return res.status(404).json(createError('not_found', 'Project not found'));
    }
    res.status(201).json({ task });
  } catch (error) {
    res.status(400).json(createError('invalid_data', 'Invalid data provided'));
  }
});

router.patch('/:taskId', async (req, res) => {
  try {
    const task = await service.updateTask(req.params.projectId, req.params.taskId, req.body);
    if (!task) {
      return res.status(404).json(createError('not_found', 'Task not found'));
    }
    res.status(200).json({ task });
  } catch (error) {
    res.status(500).json(createError('internal_error', 'Internal server error'));
  }
});

module.exports = router;
