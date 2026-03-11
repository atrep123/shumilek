const express = require('express');
const router = express.Router();
const service = require('./service');
router.post('/', (req, res) => {
  if (!req.body.name) return sendError(res, 400, 'BadRequest', 'Name is required');
  const projectId = randomUUID();
  res.json({ project: { id: projectId, name: req.body.name } });
});
router.get('/:projectId/tasks', (req, res) => {
  if (!req.query.status) return sendError(res, 400, 'BadRequest', 'Status is required');
  const tasks = service.getTasksByProject(req.params.projectId);
  const filteredTasks = tasks.filter(task => task.status === req.query.status);
  res.json({ tasks: filteredTasks });
});
module.exports = router;
