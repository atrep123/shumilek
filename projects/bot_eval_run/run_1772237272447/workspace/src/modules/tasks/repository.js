let tasks = [];
let currentId = 1;

function getAll(projectId) {
  return tasks.filter(t => t.projectId === projectId);
}

function getById(projectId, taskId) {
  return tasks.find(t => t.projectId === projectId && t.id === taskId);
}

function create(projectId, title) {
  const task = { id: currentId++, projectId, title, status: 'todo', comments: [] };
  tasks.push(task);
  return task;
}

function updateStatus(projectId, taskId, status) {
  const task = getById(projectId, taskId);
  if (!task) return null;
  task.status = status;
  return task;
}

module.exports = { getAll, getById, create, updateStatus };
