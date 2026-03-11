const { generateId } = require('../../lib/id');

let tasksStore = [];

async function getAllTasks(projectId) {
  return tasksStore.filter(task => task.projectId === projectId);
}

async function createTask(projectId, description) {
  if (!tasksStore.some(task => task.projectId === projectId)) {
    return null;
  }
  const task = { id: generateId(), projectId, description, status: 'todo' };
  tasksStore.push(task);
  return task;
}

module.exports = { getAllTasks, createTask };
