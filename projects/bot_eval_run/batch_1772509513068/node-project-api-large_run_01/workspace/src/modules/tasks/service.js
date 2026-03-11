// src/modules/tasks/service.js

const { randomUUID } = require('node:crypto');

module.exports = {
  getTasksByProject(projectId) {
    // Implement logic to get tasks by project ID
    return [];
  },

  updateTaskStatus(projectId, taskId, status) {
    if (!['todo', 'done'].includes(status)) {
      return null; // Return null for invalid status
    }
    const task = {
      id: taskId,
      projectId,
      status,
    };
    // Implement logic to update the task status
    return task;
  },
};
