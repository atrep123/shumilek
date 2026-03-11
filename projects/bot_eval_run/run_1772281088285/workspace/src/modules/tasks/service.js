const { generateId } = require('../../lib/id');
let tasksByProject = {};

function getAllTasks(projectId) {
  return tasksByProject[projectId] || [];
}

async function createTask(projectId, data) {
  if (!tasksByProject[projectId]) {
    tasksByProject[projectId] = [];
  }
  const task = { id: generateId(), ...data };
  tasksByProject[projectId].push(task);
  return task;
}

function updateTask(projectId, taskId, data) {
  const tasks = tasksByProject[projectId];
  if (!tasks) {
    return null;
  }
  const taskIndex = tasks.findIndex(t => t.id === taskId);
  if (taskIndex === -1) {
    return null;
  }
  tasks[taskIndex] = { ...tasks[taskIndex], ...data };
  return tasks[taskIndex];
}

module.exports = {
  getAllTasks,
  createTask,
  updateTask
};
