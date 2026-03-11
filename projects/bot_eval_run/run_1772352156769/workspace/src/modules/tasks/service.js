const { generateId } = require('../../lib/id');
let tasksStore = {};

const createTask = (projectId) => {
  if (!tasksStore[projectId]) {
    tasksStore[projectId] = [];
  }

  const taskId = generateId();
  const task = { id: taskId, status: 'todo' };
  tasksStore[projectId].push(task);

  return task;
};

const getTasks = (projectId) => {
  if (!tasksStore[projectId]) {
    return [];
  }

  return tasksStore[projectId];
};

const updateTask = (projectId, taskId, status) => {
  const taskIndex = tasksStore[projectId].findIndex(task => task.id === taskId);
  if (taskIndex === -1) {
    return null;
  }

  tasksStore[projectId][taskIndex].status = status;

  return tasksStore[projectId][taskIndex];
};

module.exports = { createTask, getTasks, updateTask };
