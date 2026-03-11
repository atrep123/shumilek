const express = require('express');
const router = express.Router({ mergeParams: true });
const service = require('./service');
router.post('/', (req, res) => {
  if (!req.body.name) return sendError(res, 400, 'BadRequest', 'Name is required');
  const taskId = randomUUID();
  const newTask = { id: taskId, name: req.body.name, status: 'todo' };
  service.addTaskToProject(req.params.projectId, newTask);
  res.json({ task: newTask });
});
router.patch('/:taskId', (req, res) => {
  const task = service.getTaskById(req.params.projectId, req.params.taskId);
  if (!task) return sendError(res, 404, 'NotFound', 'Task not found');
  if (['todo', 'done'].includes(req.body.status)) task.status = req.body.status;
  res.json({ task });
});
module.exports = router;
