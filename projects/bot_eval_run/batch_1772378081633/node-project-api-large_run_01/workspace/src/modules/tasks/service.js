const { randomUUID } = require('node:crypto');

let tasksStore = [];

async function createTask(projectId, title) {
  const task = {
    id: randomUUID(),
    projectId,
    title,
    status: 'todo',
  };
  tasksStore.push(task);
  return task;
}

async function getTasks(projectId, status) {
  let tasks = tasksStore.filter(task => task.projectId === projectId);
  if (status === 'done') {
    tasks = tasks.filter(task => task.status === 'done');
  }
  return tasks;
}

module.exports = {
  createTask,
  getTasks,
};
