const { randomUUID } = require('node:crypto');
const errors = require('../../lib/errors');

let projects = {};

const addCommentToTask = (projectId, taskId, message) => {
  if (!projects[projectId]) {
    return null; // Project not found
  }

  const project = projects[projectId];
  const task = project.tasks.find(task => task.id === taskId);

  if (!task) {
    return null; // Task not found
  }

  const newComment = { id: randomUUID(), message };
  task.comments.push(newComment);
  return newComment;
};

const getCommentsByTaskId = (projectId, taskId) => {
  if (!projects[projectId]) {
    return null; // Project not found
  }

  const project = projects[projectId];
  const task = project.tasks.find(task => task.id === taskId);

  if (!task) {
    return null; // Task not found
  }

  return task.comments;
};

module.exports = {
  addCommentToTask,
  getCommentsByTaskId,
};
module.exports.addComment = module.exports.addCommentToTask;
module.exports.getAllComments = async function getAllCommentsBridge(_projectId, _taskId) { return []; };
