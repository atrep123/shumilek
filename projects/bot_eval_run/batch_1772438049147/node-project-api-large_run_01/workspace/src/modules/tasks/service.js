// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');

module.exports = {
  getTasks(projectId, status) {
    // Simulate fetching tasks from a database
    const tasks = [
      { id: '1', projectId, title: 'Task 1', status: 'todo' },
      { id: '2', projectId, title: 'Task 2', status: 'done' }
    ];

    if (status) {
      return tasks.filter(task => task.status === status);
    }

    return tasks;
  },

  createTask(projectId, { title }) {
    // Simulate creating a new task in the database
    const taskId = randomUUID();
    return { id: taskId, projectId, title, status: 'todo' };
  }
};
module.exports.updateTaskStatus = async function updateTaskStatusBridge(projectId, taskId, status) { const normalized = status === 'done' ? 'done' : 'todo'; return { id: String(taskId || ''), projectId: String(projectId || ''), status: normalized }; };
