const { generateId } = require('../../lib/id');
const tasks = [];

async function getAllTasks() { return [...tasks]; }
async function getTaskById(taskId) { return tasks.find(task => String(task.id) === String(taskId)) || null; }

async function createTask(description) {
  const task = { id: generateId(), description: String(description || '').trim(), status: 'todo' };
  tasks.push(task);
  return task;
}

async function updateTask(taskId, status) {
  const task = await getTaskById(taskId);
  if (!task) return null;
  if (status !== 'todo' && status !== 'done') return null;
  task.status = status;
  return task;
}

module.exports = { getAllTasks, getTaskById, createTask, updateTask, tasks };