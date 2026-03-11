const express = require('express');
const router = express.Router();
const taskService = require('./service');

router.get('/:projectId/tasks', (req, res) => {
  try {
    const tasks = taskService.getAllTasksByProjectId(req.params.projectId);
    res.status(200).json({ tasks });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: { code: error.code, message: error.message } });
  }
});

router.post('/:projectId/tasks', (req, res) => {
  try {
    const task = taskService.createTask(req.params.projectId, req.body.name);
    res.status(201).json({ task });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: { code: error.code, message: error.message } });
  }
});

module.exports = (app) => app.use('/projects', router);
