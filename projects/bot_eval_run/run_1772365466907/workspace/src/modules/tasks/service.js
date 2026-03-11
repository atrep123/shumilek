const { randomUUID } = require('node:crypto');
const projectService = require('../projects/service');

let tasks = [];

function addTask(projectId) {
  const project = projectService.getProjectById(projectId);
  if (!project) return null;

  const task = { id: randomUUID(), projectId, status: 'todo' };
  tasks.push(task);
  return task;
}

function getTasksByProject(projectId) {
  const project = projectService.getProjectById(projectId);
  if (!project) return null;

  return tasks.filter(t => t.projectId === projectId);
}

function updateTaskStatus(projectId, taskId, status) {
  const taskIndex = tasks.findIndex(t => t.id === taskId && t.projectId === projectId);
  if (taskIndex === -1) return null;

  tasks[taskIndex].status = status;
  return tasks[taskIndex];
}

module.exports = {
  addTask,
  getTasksByProject,
  updateTaskStatus,
};
