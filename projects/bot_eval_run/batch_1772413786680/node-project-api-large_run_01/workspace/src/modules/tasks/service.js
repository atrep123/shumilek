const { randomUUID } = require('../../lib/id');

let tasksStore = [];

const createTask = async (projectId, title) => {
  const taskId = randomUUID();
  const task = { id: taskId, projectId, title, status: 'pending' };
  tasksStore.push(task);
  return task;
};

const getTasks = async (projectId) => {
  return tasksStore.filter(task => task.projectId === projectId);
};

const updateTaskStatus = async (taskId, status) => {
  const task = tasksStore.find(task => task.id === taskId);
  if (!task) {
    return null;
  }
  task.status = status;
  return task;
};

module.exports = { createTask, getTasks, updateTaskStatus };
