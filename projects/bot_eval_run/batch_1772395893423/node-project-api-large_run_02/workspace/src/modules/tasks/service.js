// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');

let tasksStore = [];

module.exports = {
  getAllTasks(projectId) {
    return tasksStore.filter(task => task.projectId === projectId);
  },

  createTask(projectId, title) {
    if (!title || typeof title !== 'string' || title.trim() === '') {
      return null;
    }
    const newTask = {
      id: randomUUID(),
      projectId,
      title: title.trim(),
      status: 'todo'
    };
    tasksStore.push(newTask);
    return newTask;
  },

  updateTaskStatus(taskId, status) {
    if (status !== 'todo' && status !== 'done') {
      return null;
    }
    const task = tasksStore.find(t => t.id === taskId);
    if (!task) {
      return null;
    }
    task.status = status;
    return task;
  }
};
