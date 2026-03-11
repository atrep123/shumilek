const express = require('express');
const service = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router({ mergeParams: true });

router.post('/', async (req, res) => {
  try {
    const task = await service.createTask(req.params.projectId, req.body.title);
    res.status(201).json({ task });
  } catch (error) {
    return sendError(res, 500, 'INTERNAL_ERROR', String(error?.message || 'Internal server error'));
  }
});

router.get('/', async (req, res) => {
  try {
    const tasks = await service.getAllTasks(req.params.projectId, req.query.status);
    res.status(200).json({ tasks });
  } catch (error) {
    return sendError(res, 500, 'INTERNAL_ERROR', String(error?.message || 'Internal server error'));
  }
});

router.patch('/:taskId', async (req, res) => {
  try {
    const task = await service.updateTask(req.params.projectId, req.params.taskId, req.body.status);
    res.status(200).json({ task });
  } catch (error) {
    return sendError(res, 500, 'INTERNAL_ERROR', String(error?.message || 'Internal server error'));
  }
});

module.exports = router;
