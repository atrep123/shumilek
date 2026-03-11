// src/modules/comments/service.js
const { randomUUID } = require('node:crypto');
const tasksService = require('../tasks/service');
const { sendError } = require('../../lib/errors');

let commentsStore = [];

async function addComment(projectId, taskId, content) {
  const task = await tasksService.getTasksByStatus(projectId).find(t => t.id === taskId);
  if (!task) {
    return null;
  }

  const comment = { id: randomUUID(), projectId, taskId, content };
  commentsStore.push(comment);
  return comment;
}

module.exports = {
  addComment,
};
