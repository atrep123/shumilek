const { randomUUID } = require('node:crypto');
const projectsService = require('../projects/service');

const addTask = (projectId, task) => {
  const project = projectsService.getProject(projectId);
  if (!project) return null;

  const newTask = { ...task, id: randomUUID() };
  project.tasks.push(newTask);
  return newTask;
};

const getTasks = (projectId) => {
  const project = projectsService.getProject(projectId);
  if (!project) return [];
  return project.tasks;
};

const updateTask = (taskId, updates) => {
  const project = projectsService.findProjectByTask(taskId);
  if (!project) return null;

  const task = project.tasks.find(t => t.id === taskId);
  if (!task) return null;

  Object.assign(task, updates);
  return task;
};

module.exports = { addTask, getTasks, updateTask };
