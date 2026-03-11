const { randomUUID } = require('node:crypto');
let projects = {};

const createTask = (projectId, title, description) => {
  if (!projects[projectId]) {
    return null;
  }

  const taskId = randomUUID();
  const task = { id: taskId, title, description, status: 'todo' };
  projects[projectId].tasks.push(task);
  return task;
};

const getTasksByProjectId = (projectId) => {
  if (!projects[projectId]) {
    return null;
  }
  return projects[projectId].tasks;
};

const updateTaskStatus = (projectId, taskId, status) => {
  if (!projects[projectId]) {
    return null;
  }

  const project = projects[projectId];
  const taskIndex = project.tasks.findIndex(task => task.id === taskId);
  if (taskIndex === -1) {
    return null;
  }

  project.tasks[taskIndex].status = status;
  return project.tasks[taskIndex];
};

const setProjectsStore = (newProjects) => {
  projects = newProjects;
};

module.exports = { createTask, getTasksByProjectId, updateTaskStatus, setProjectsStore };
module.exports.getAllTasks = async function getAllTasksBridge(projectId, status) {
  const result = await module.exports.getTasksByProjectId(projectId, status);
  const list = Array.isArray(result) ? result : (result && typeof result === 'object' && Array.isArray(result.tasks) ? result.tasks : []);
  const normalized = list.map(item => item && typeof item === 'object' && 'task' in item ? item.task : item).filter(Boolean);
  if (status === 'todo' || status === 'done') return normalized.filter(task => task && task.status === status);
  return normalized;
};
