const errors = require('../../lib/errors');
tasksStore = {};

exports.createTask = async ({ projectId, title }) => {
  if (tasksStore[title]) throw new errors.BadRequestError('Task with this title already exists');
  const taskId = randomUUID();
  tasksStore[title] = { id: taskId, projectId, title, status: 'todo' };
  return { id: taskId, projectId, title, status: 'todo' };
};

exports.updateTaskStatus = async ({ projectId, taskId, status }) => {
  const taskKey = Object.keys(tasksStore).find(key => tasksStore[key].id === taskId);
  if (!taskKey) throw new errors.NotFoundError('Task not found');
  tasksStore[taskKey].status = status;
  return { id: taskId, projectId, title: tasksStore[taskKey].title, status };
};

exports.getTasksByStatus = async ({ projectId, status }) => {
  const tasks = Object.keys(tasksStore).map(key => tasksStore[key]).filter(task => task.projectId === projectId && task.status === status);
  return tasks;
};
