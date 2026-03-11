const { generateId } = require('../../lib/id');
let projectsStore = {};

const createTask = (projectId, name) => {
  if (!projectsStore[projectId]) {
    return null;
  }

  const taskId = generateId();
  const task = { id: taskId, name, status: 'todo', comments: [] };
  projectsStore[projectId].tasks[taskId] = task;
  return task;
};

const getAllTasks = (projectId) => {
  if (!projectsStore[projectId]) {
    return null;
  }

  const tasks = Object.values(projectsStore[projectId].tasks);
  return tasks;
};

const updateTask = (projectId, taskId, status) => {
  if (!projectsStore[projectId] || !projectsStore[projectId].tasks[taskId]) {
    return null;
  }

  const task = projectsStore[projectId].tasks[taskId];
  task.status = status;
  return task;
};

module.exports = { createTask, getAllTasks, updateTask };
