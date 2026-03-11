// src/modules/comments/service.js
const { randomUUID } = require('node:crypto');
const tasksService = require('../tasks/service');

async function addComment(projectId, taskId, commentData) {
  const task = await tasksService.getTaskById(projectId, taskId);
  if (!task) {
    return null;
  }

  const newComment = {
    id: randomUUID(),
    ...commentData,
  };

  task.comments.push(newComment);
  await tasksService.updateTask(projectId, taskId, { comments: task.comments });

  return newComment;
}

module.exports = { addComment };
