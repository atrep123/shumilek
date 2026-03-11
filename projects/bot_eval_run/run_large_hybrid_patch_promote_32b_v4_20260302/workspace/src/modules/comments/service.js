const { randomUUID } = require('node:crypto');
const tasksService = require('../tasks/service');

const addComment = (taskId, comment) => {
  const task = tasksService.getTask(taskId);
  if (!task) return null;

  const newComment = { ...comment, id: randomUUID() };
  task.comments.push(newComment);
  return newComment;
};

module.exports = { addComment };
