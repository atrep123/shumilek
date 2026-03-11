const { randomUUID } = require('node:crypto');

let projects = {};

function addTask(projectId, task) {
  if (!projects[projectId]) {
    projects[projectId] = [];
  }

  const newTask = { id: randomUUID(), status: 'todo', ...task };
  projects[projectId].push(newTask);
  return newTask;
}

function getTasks(projectId, status) {
  if (!projects[projectId]) {
    return [];
  }

  if (status) {
    return projects[projectId].filter(task => task.status === status);
  }

  return projects[projectId];
}

module.exports = {
  addTask,
  getTasks,
};
