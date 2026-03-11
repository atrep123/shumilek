const express = require('express');
const service = require('./service');
const { errorHandler } = require('../../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const task = await service.createTask(req.params.projectId, req.body);
    res.status(201).json({ task });
  } catch (error) {
    errorHandler(res, error);
  }
});

router.get('/', async (req, res) => {
  try {
    const tasks = await service.getAllTasks(req.params.projectId, req.query.status);
    res.json({ tasks: Object.values(tasks) });
  } catch (error) {
    errorHandler(res, error);
  }
});

router.patch('/:taskId', async (req, res) => {
  try {
    const task = await service.updateTask(req.params.projectId, req.params.taskId, req.body);
    res.json({ task });
  } catch (error) {
    errorHandler(res, error);
  }
});

router.use('/:taskId/comments', require('./comments/routes'));

module.exports = router;
