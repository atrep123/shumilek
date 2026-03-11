const express = require('express');
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  const { title } = req.body;
  if (!title) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'Title is required');
  }
  try {
    const task = await tasksService.createTask(req.params.projectId, title);
    res.json({ task });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

router.get('/', async (req, res) => {
  const { status } = req.query;
  try {
    let tasks = await tasksService.getTasks(req.params.projectId);
    if (status === 'done') {
      tasks = tasks.filter(task => task.status === 'done');
    }
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

router.patch('/:taskId', async (req, res) => {
  const { status } = req.body;
  if (!status || ![ 'done', 'pending' ].includes(status)) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'Invalid status');
  }
  try {
    const task = await tasksService.updateTaskStatus(req.params.taskId, status);
    res.json({ task });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

module.exports = router;
