const crypto = require('crypto');
const tasksRepo = {};

function getTasksByProjectId(projectId) {
  return Object.values(tasksRepo).filter(task => task.projectId === projectId);
}

function createTask(projectId, title) {
  if (!title) throw { status: 400, code: 'INVALID_INPUT', message: 'Title is required' };
  const id = crypto.randomUUID();
  tasksRepo[id] = { id, projectId, title, status: 'pending' };
  return tasksRepo[id];
}

function updateTask(projectId, taskId, status) {
  if (!status) throw { status: 400, code: 'INVALID_INPUT', message: 'Status is required' };
  const task = tasksRepo[taskId];
  if (!task || task.projectId !== projectId) throw { status: 404, code: 'TASK_NOT_FOUND', message: 'Task not found' };
  task.status = status;
  return task;
}

module.exports = {
  getTasksByProjectId,
  createTask,
  updateTask
};
