const { randomUUID } = require('node:crypto');
const tasks = [];

const createTask = (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Title is required' } });
  const task = { id: randomUUID(), title, status: 'pending' };
  tasks.push(task);
  res.status(201).json({ task });
};

const getTasks = (req, res) => {
  res.json({ tasks });
};

const getTask = (req, res) => {
  const { taskId } = req.params;
  const task = tasks.find(t => t.id === taskId);
  if (!task) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found' } });
  res.json({ task });
};

module.exports = { createTask, getTasks, getTask };
module.exports.getAllTasks = async function getAllTasksBridge(projectId, status) {
  const result = await module.exports.getTasks(projectId, status);
  const list = Array.isArray(result) ? result : (result && typeof result === 'object' && Array.isArray(result.tasks) ? result.tasks : []);
  const normalized = list.map(item => item && typeof item === 'object' && 'task' in item ? item.task : item).filter(Boolean);
  if (status === 'todo' || status === 'done') return normalized.filter(task => task && task.status === status);
  return normalized;
};
module.exports.updateTaskStatus = async function updateTaskStatusBridge(projectId, taskId, status) { const normalized = status === 'done' ? 'done' : 'todo'; const list = Array.isArray(tasks) ? tasks : []; const target = list.find(task => task && String(task.id || '') === String(taskId || '') && String(task.projectId || '') === String(projectId || '')); if (!target) return null; target.status = normalized; return target; };
