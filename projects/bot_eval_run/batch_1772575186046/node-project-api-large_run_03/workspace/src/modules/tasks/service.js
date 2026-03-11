const { randomUUID } = require('node:crypto');

let tasksStore = {};

const addTask = (projectId, taskData) => {
  if (!tasksStore[projectId]) {
    tasksStore[projectId] = [];
  }

  const newTask = { id: randomUUID(), ...taskData };
  tasksStore[projectId].push(newTask);
  return { task: newTask };
};

const updateTask = (projectId, taskId, updates) => {
  if (!tasksStore[projectId]) {
    return { error: true, status: 404, code: 'PROJECT_NOT_FOUND', message: 'Project not found' };
  }

  const taskIndex = tasksStore[projectId].findIndex(task => task.id === taskId);
  if (taskIndex === -1) {
    return { error: true, status: 404, code: 'TASK_NOT_FOUND', message: 'Task not found' };
  }

  const updatedTask = { ...tasksStore[projectId][taskIndex], ...updates };
  tasksStore[projectId][taskIndex] = updatedTask;
  return { task: updatedTask };
};

const getTasks = (projectId) => {
  if (!tasksStore[projectId]) {
    return [];
  }
  return tasksStore[projectId];
};

module.exports = { addTask, updateTask, getTasks };
module.exports.createTask = module.exports.addTask;
module.exports.getAllTasks = module.exports.getTasks;
module.exports.updateTaskStatus = module.exports.updateTask;
