const express = require('express');
tasksService = require('./service');
sendError = require('../../lib/errors').sendError;

const router = express.Router();

router.get('/', (req, res) => {
  const { projectId } = req.params;
  const project = projectsService.getProjectById(projectId);
  if (!project) {
    return sendError(res, 404, 'NOT_FOUND', 'Project not found');
  }

  let tasks = project.tasks;
  const statusFilter = req.query.status;
  if (statusFilter) {
    tasks = tasks.filter(task => task.status === statusFilter);
  }
  res.json({ tasks });
});

router.post('/', (req, res) => {
  const { projectId } = req.params;
  const project = projectsService.getProjectById(projectId);
  if (!project) {
    return sendError(res, 404, 'NOT_FOUND', 'Project not found');
  }

  const task = tasksService.createTask(req.body.title, projectId);
  res.status(201).json({ task });
});

router.patch('/:taskId', (req, res) => {
  const { projectId, taskId } = req.params;
  const project = projectsService.getProjectById(projectId);
  if (!project) {
    return sendError(res, 404, 'NOT_FOUND', 'Project not found');
  }

  const task = tasksService.updateTask(taskId, req.body.status);
  if (!task) {
    return sendError(res, 404, 'NOT_FOUND', 'Task not found');
  }
  res.json({ task });
});

module.exports = router;
