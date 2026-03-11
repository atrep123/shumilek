const { randomUUID } = require('node:crypto');
const tasksStore = [];

async function getAllTasks(projectId) {
  return tasksStore.filter(task => task.projectId === projectId);
}

async function getTaskById(projectId, taskId) {
  return tasksStore.find(task => task.projectId === projectId && task.id === taskId);
}

async function createTask(projectId, title) {
  const task = { id: randomUUID(), projectId, title, status: 'todo' };
  tasksStore.push(task);
  return task;
}

async function updateTaskStatus(projectId, taskId, newStatus) {
  const task = await getTaskById(projectId, taskId);
  if (!task) {
    return null;
  }
  task.status = newStatus;
  return task;
}

module.exports = {
  getAllTasks,
  getTaskById,
  createTask,
  updateTaskStatus,
};
module.exports.getTasks = module.exports.getAllTasks;
