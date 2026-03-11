const { generateId } = require('../../lib/id');

const projects = {};

function createTask(projectId, title) {
  if (!projects[projectId]) {
    throw new Error('Project not found');
  }

  const taskId = generateId();
  const task = { id: taskId, title, status: 'open', comments: [] };

  projects[projectId].tasks.push(task);
  return task;
}

function getTasks(projectId, status) {
  if (!projects[projectId]) {
    throw new Error('Project not found');
  }

  const tasks = projects[projectId].tasks;
  if (status) {
    return tasks.filter(task => task.status === status);
  }

  return tasks;
}

function updateTask(projectId, taskId, status) {
  if (!projects[projectId]) {
    throw new Error('Project not found');
  }

  const task = projects[projectId].tasks.find(task => task.id === taskId);
  if (task) {
    task.status = status;
  }

  return task;
}

module.exports = { createTask, getTasks, updateTask };
