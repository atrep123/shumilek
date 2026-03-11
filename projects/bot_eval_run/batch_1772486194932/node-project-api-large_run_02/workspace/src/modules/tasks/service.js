const { randomUUID } = require('../../lib/id');

let tasksStore = {};

const createTask = async (projectId, title) => {
  const taskId = randomUUID();
  if (!tasksStore[projectId]) {
    tasksStore[projectId] = [];
  }
  tasksStore[projectId].push({ id: taskId, title, status: 'todo' });
  return { id: taskId, title, status: 'todo' };
};

const updateTask = async (projectId, taskId, status) => {
  if (!tasksStore[projectId]) {
    return null;
  }
  const taskIndex = tasksStore[projectId].findIndex(task => task.id === taskId);
  if (taskIndex === -1) {
    return null;
  }
  tasksStore[projectId][taskIndex].status = status;
  return tasksStore[projectId][taskIndex];
};

const getTasks = async (projectId) => {
  if (!tasksStore[projectId]) {
    return [];
  }
  return tasksStore[projectId];
};

module.exports = { createTask, updateTask, getTasks };
module.exports.getAllTasks = module.exports.getTasks;
