const { randomUUID } = require('../../lib/id');

let tasksStore = [];

const createTask = (projectId, title) => {
  const taskId = randomUUID();
  const task = { id: taskId, projectId, title, status: 'todo' };
  tasksStore.push(task);
  return Promise.resolve(task);
};

const getTasks = (projectId) => {
  const tasks = tasksStore.filter(task => task.projectId === projectId);
  return Promise.resolve(tasks);
};

const updateTaskStatus = (taskId, status) => {
  if (!['todo', 'done'].includes(status)) {
    return Promise.reject({ code: 'INVALID_STATUS', message: 'Invalid task status' });
  }
  const task = tasksStore.find(task => task.id === taskId);
  if (!task) {
    return Promise.reject({ code: 'TASK_NOT_FOUND', message: 'Task not found' });
  }
  task.status = status;
  return Promise.resolve(task);
};

module.exports = { createTask, getTasks, updateTaskStatus };
