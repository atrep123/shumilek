// src/modules/comments/service.js
const { randomUUID } = require('node:crypto');
const { sendError } = require('../../lib/errors');

let commentsStore = [];

async function createComment(content) {
  if (!content) {
    return null;
  }
  const comment = { id: randomUUID(), content };
  commentsStore.push(comment);
  return comment;
}

module.exports = { createComment };
