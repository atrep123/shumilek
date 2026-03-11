// src/modules/comments/service.js
const { randomUUID } = require('node:crypto');

let commentsStore = [];

module.exports = {
  addComment(taskId, message) {
    const comment = { id: randomUUID(), taskId, message };
    commentsStore.push(comment);
    return comment;
  }
};
