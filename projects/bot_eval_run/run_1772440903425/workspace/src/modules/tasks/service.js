const tasks = {};
const addTaskToProject = (projectId, task) => {
  if (!task.name) return null;
  if (!['todo', 'done'].includes(task.status)) return null;
  if (!tasks[projectId]) tasks[projectId] = [];
  tasks[projectId].push(task);
};
const getTaskById = (projectId, taskId) => tasks[projectId]?.find(task => task.id === taskId);
module.exports = { addTaskToProject, getTaskById };
