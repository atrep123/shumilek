const { v4: uuidv4 } = require('crypto').randomUUID;
const projectService = require('../projects/service');

function getAllTasks(projectId) {
  const project = projectService.getAllProjects().find(p => p.id === projectId);
  if (!project || !project.tasks) {
    return [];
  }
  return project.tasks;
}

function createTask(projectId, title) {
  const project = projectService.getAllProjects().find(p => p.id === projectId);
  if (!project) {
    throw new Error('Project not found');
  }
  const task = { id: uuidv4(), title, status: 'todo' };
  if (!project.tasks) {
    project.tasks = [];
  }
  project.tasks.push(task);
  return task;
}

function updateTask(projectId, taskId, status) {
  const project = projectService.getAllProjects().find(p => p.id === projectId);
  if (!project || !project.tasks) {
    throw new Error('Project or task not found');
  }
  const task = project.tasks.find(t => t.id === taskId);
  if (!task) {
    throw new Error('Task not found');
  }
  task.status = status;
  return task;
}

module.exports = {
  getAllTasks,
  createTask,
  updateTask
};
