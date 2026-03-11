const { randomUUID } = require('node:crypto');

let tasks = [];

const createTask = (projectId, message) => {
  const task = { id: randomUUID(), projectId, message, status: 'todo' };
  tasks.push(task);
  return task;
};

const updateTaskStatus = (projectId, taskId, status) => {
  const task = tasks.find(t => t.id === taskId && t.projectId === projectId);
  if (!task) {
    return null;
  }
  task.status = status;
  return task;
};

module.exports = {
  createTask,
  updateTaskStatus
};
