// src/modules/comments/service.js
const { randomUUID } = require('node:crypto');

let commentsStore = [];

const createComment = (content) => {
  const comment = { id: randomUUID(), content };
  commentsStore.push(comment);
  return comment;
};

module.exports = { createComment };