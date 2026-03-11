const { generateId } = require('../../lib/id');
const tasks = [];
async function getAllTasks(projectId, status) {
  const byProject = tasks.filter(task => String(task.projectId) === String(projectId));
  if (status === 'todo' || status === 'done') return byProject.filter(task => task.status === status);
  return byProject;
}
async function createTask(projectId, title) {
  const task = { id: generateId(), projectId: String(projectId), title: String(title || ''), status: 'todo' };
  tasks.push(task);
  return task;
}
async function getTaskById(projectId, taskId) {
  return tasks.find(task => String(task.projectId) === String(projectId) && String(task.id) === String(taskId)) || null;
}
async function updateTaskStatus(projectId, taskId, status) {
  const task = await getTaskById(projectId, taskId);
  if (!task) return null;
  task.status = status;
  return task;
}
module.exports = { getAllTasks, createTask, getTaskById, updateTaskStatus, tasks };
module.exports.updateTask = module.exports.updateTaskStatus;
