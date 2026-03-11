const { randomUUID } = require('../../lib/id');

let tasksStore = [];

const getAllTasks = async (projectId) => {
  return tasksStore.filter(task => task.projectId === projectId);
};

const createTask = async (projectId, description) => {
  const taskId = randomUUID();
  const task = { id: taskId, projectId, description, status: 'todo' };
  tasksStore.push(task);
  return task;
};

const updateTaskStatus = async (projectId, taskId, status) => {
  const taskIndex = tasksStore.findIndex(task => task.id === taskId && task.projectId === projectId);
  if (taskIndex === -1) {
    return null;
  }
  tasksStore[taskIndex].status = status;
  return tasksStore[taskIndex];
};

module.exports = { getAllTasks, createTask, updateTaskStatus };
