// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');

module.exports = {
  getTasks(projectId, status) {
    // Simulate fetching tasks from a database
    const tasks = [
      { id: '1', projectId, status: 'todo' },
      { id: '2', projectId, status: 'done' }
    ];

    if (status) {
      return tasks.filter(task => task.status === status);
    }

    return tasks;
  },

  createTask(projectId, taskData) {
    // Simulate creating a new task in the database
    const newTask = {
      id: randomUUID(),
      projectId,
      ...taskData
    };

    // Return the newly created task
    return newTask;
  },

  updateTaskStatus(taskId, status) {
    // Simulate updating a task's status in the database
    const tasks = [
      { id: '1', projectId: 'project1', status: 'todo' },
      { id: '2', projectId: 'project1', status: 'done' }
    ];

    const task = tasks.find(t => t.id === taskId);

    if (task) {
      task.status = status;
      return task;
    }

    return null;
  }
};
module.exports.getTasksByProjectId = module.exports.getTasks;
