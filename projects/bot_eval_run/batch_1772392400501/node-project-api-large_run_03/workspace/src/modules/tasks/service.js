const { generateId } = require('../../lib/id');

let tasksStore = [];

const createTask = async (projectId, title) => {
  const task = { id: generateId(), projectId, title, status: 'todo' };
  tasksStore.push(task);
  return task;
};

const getAllTasks = async (projectId, status) => {
  let tasks = tasksStore.filter(task => task.projectId === projectId);
  if (status) {
    tasks = tasks.filter(task => task.status === status);
  }
  return tasks;
};

const updateTaskStatus = async (projectId, taskId, status) => {
  const task = tasksStore.find(task => task.id === taskId && task.projectId === projectId);
  if (!task) {
    throw new Error('Task not found');
  }
  task.status = status;
  return task;
};

module.exports = { createTask, getAllTasks, updateTaskStatus };