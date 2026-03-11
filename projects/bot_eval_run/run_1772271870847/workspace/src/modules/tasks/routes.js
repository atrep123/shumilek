const express = require('express');
const { createTask, getTasksByProjectId, updateTaskStatus } = require('./service');

const router = express.Router();

router.post('/:projectId/tasks', (req, res) => {
  const { projectId } = req.params;
  const { title } = req.body;
  try {
    const task = createTask(projectId, title);
    res.status(201).json({ task });
  } catch (error) {
    res.status(error.code === 'not_found' ? 404 : 400).json({ error: { code: error.code, message: error.message } });
  }
});

router.get('/:projectId/tasks', (req, res) => {
  const { projectId } = req.params;
  const { status } = req.query;
  try {
    const tasks = getTasksByProjectId(projectId, status);
    res.json({ tasks });
  } catch (error) {
    res.status(404).json({ error: { code: 'not_found', message: 'Project not found' } });
  }
});

router.patch('/:projectId/tasks/:taskId', (req, res) => {
  const { projectId, taskId } = req.params;
  const { status } = req.body;
  try {
    const task = updateTaskStatus(projectId, taskId, status);
    res.json({ task });
  } catch (error) {
    res.status(error.code === 'not_found' ? 404 : 400).json({ error: { code: error.code, message: error.message } });
  }
});

module.exports = router;
