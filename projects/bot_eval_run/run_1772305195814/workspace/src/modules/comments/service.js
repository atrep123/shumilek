const { v4: uuidv4 } = require('crypto').randomUUID;
const taskService = require('../tasks/service');

function getAllComments(projectId, taskId) {
  const tasks = taskService.getAllTasks(projectId);
  const task = tasks.find(t => t.id === taskId);
  if (!task || !task.comments) {
    return [];
  }
  return task.comments;
}

function addComment(projectId, taskId, message) {
  const tasks = taskService.getAllTasks(projectId);
  const task = tasks.find(t => t.id === taskId);
  if (!task) {
    throw new Error('Task not found');
  }
  const comment = { id: uuidv4(), message };
  if (!task.comments) {
    task.comments = [];
  }
  task.comments.push(comment);
  return comment;
}

module.exports = {
  getAllComments,
  addComment
};
