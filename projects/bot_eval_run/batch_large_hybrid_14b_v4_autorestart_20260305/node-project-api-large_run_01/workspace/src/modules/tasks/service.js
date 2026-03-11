const { randomUUID } = require('node:crypto');
let projectsTasks = {};

const createTask = (projectId, title) => {
  if (!projectsTasks[projectId]) {
    projectsTasks[projectId] = [];
  }
  const taskId = randomUUID();
  const task = { id: taskId, title, status: 'not-started' };
  projectsTasks[projectId].push(task);
  return task;
};

const getAllTasks = (projectId) => {
  return projectsTasks[projectId] || [];
};

const filterTasksByStatus = (projectId, status) => {
  const tasks = getAllTasks(projectId);
  if (!tasks) {
    return null;
  }
  return tasks.filter(t => t.status === status);
};

const updateTaskStatus = (projectId, taskId, status) => {
  const tasks = getAllTasks(projectId);
  if (!tasks) {
    return null;
  }
  const task = tasks.find(t => t.id === taskId);
  if (!task) {
    return null;
  }
  task.status = status;
  return task;
};

module.exports = { createTask, getAllTasks, filterTasksByStatus, updateTaskStatus };
