// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');
const projectsService = require('../projects/service');

async function addTask(projectId, taskData) {
  const project = await projectsService.getProjectById(projectId);
  if (!project) {
    return null;
  }

  const newTask = {
    id: randomUUID(),
    status: 'todo',
    ...taskData,
  };

  project.tasks.push(newTask);
  await projectsService.updateProject(projectId, project);

  return newTask;
}

async function getTasks(projectId) {
  const project = await projectsService.getProjectById(projectId);
  if (!project) {
    return null;
  }

  return project.tasks || [];
}

async function updateTask(projectId, taskId, taskData) {
  const project = await projectsService.getProjectById(projectId);
  if (!project) {
    return null;
  }

  const taskIndex = project.tasks.findIndex(task => task.id === taskId);
  if (taskIndex === -1) {
    return null;
  }

  project.tasks[taskIndex] = { ...project.tasks[taskIndex], ...taskData };
  await projectsService.updateProject(projectId, project);

  return project.tasks[taskIndex];
}

module.exports = { addTask, getTasks, updateTask };
