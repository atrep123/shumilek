const { randomUUID } = require('node:crypto');
const projectService = require('../projects/service');

function getAllTasks(projectId) {
  const project = projectService.getAllProjects().find(p => p.id === projectId);
  return project ? project.tasks : [];
}

function createTask(projectId, title) {
  const task = { id: randomUUID(), title, status: 'todo' };
  const project = projectService.getAllProjects().find(p => p.id === projectId);
  if (project) {
    project.tasks.push(task);
  }
  return task;
}

function updateTask(projectId, taskId, status) {
  const project = projectService.getAllProjects().find(p => p.id === projectId);
  if (!project) {
    return null;
  }

  const taskIndex = project.tasks.findIndex(task => task.id === taskId);
  if (taskIndex === -1) {
    return null;
  }

  project.tasks[taskIndex].status = status;
  return project.tasks[taskIndex];
}

module.exports = {
  getAllTasks,
  createTask,
  updateTask,
};
