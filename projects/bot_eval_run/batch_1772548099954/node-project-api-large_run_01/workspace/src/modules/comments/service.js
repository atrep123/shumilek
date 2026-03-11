const { randomUUID } = require('node:crypto');
const tasksService = require('../tasks/service');

const addCommentToTask = (projectId, taskId, message) => {
  const task = tasksService.getTasksByProjectId(projectId)?.find(task => task.id === taskId);
  if (!task) {
    return null;
  }
  const comment = { id: randomUUID(), message };
  task.comments = task.comments || [];
  task.comments.push(comment);
  return comment;
};

module.exports = { addCommentToTask, getAllComments: (projectId, taskId) => {
  const task = tasksService.getTasksByProjectId(projectId)?.find(task => task.id === taskId);
  if (!task) {
    return [];
  }
  return task.comments || [];
} };
