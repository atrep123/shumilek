const idService = require('../lib/id');
const errors = require('../lib/errors');
const projectService = require('../projects/service');

let tasks = [];

function getTasksByProjectId(projectId, status) {
  const project = projectService.getProjectById(projectId);
  let filteredTasks = tasks.filter(t => t.projectId === projectId);
  if (status) {
    filteredTasks = filteredTasks.filter(t => t.status === status);
  }
  return filteredTasks;
}

function createTask(projectId, title) {
  projectService.getProjectById(projectId);
  const task = { id: idService.generateId(), projectId, title, status: 'pending' };
  tasks.push(task);
  return task;
}

function updateTaskStatus(projectId, taskId, status) {
  projectService.getProjectById(projectId);
  const taskIndex = tasks.findIndex(t => t.id === taskId && t.projectId === projectId);
  if (taskIndex === -1) {
    throw new Error('not_found', 'Task not found.');
  }
  tasks[taskIndex].status = status;
  return tasks[taskIndex];
}

module.exports = { getTasksByProjectId, createTask, updateTaskStatus };
