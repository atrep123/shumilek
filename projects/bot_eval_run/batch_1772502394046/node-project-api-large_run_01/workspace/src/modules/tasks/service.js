// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');
const projectsService = require('../../modules/projects/service');

module.exports = {
  createTask,
  updateTaskStatus,
  getTasksByProjectId,
};

function createTask(projectId, title) {
  const project = projectsService.getProjectById(projectId);
  if (!project) return null;

  const task = {
    id: randomUUID(),
    projectId,
    title,
    status: 'todo',
  };

  project.tasks.push(task);
  return task;
}

function updateTaskStatus(projectId, taskId, newStatus) {
  if (newStatus !== 'todo' && newStatus !== 'done') return null;

  const project = projectsService.getProjectById(projectId);
  if (!project) return null;

  const task = project.tasks.find(t => t.id === taskId);
  if (!task) return null;

  task.status = newStatus;
  return task;
}

function getTasksByProjectId(projectId, statusFilter) {
  const project = projectsService.getProjectById(projectId);
  if (!project) return null;

  let tasks = project.tasks;
  if (statusFilter === 'todo' || statusFilter === 'done') {
    tasks = tasks.filter(task => task.status === statusFilter);
  }

  return tasks;
}
