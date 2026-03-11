const { generateId } = require('../../lib/id');
const comments = [];

async function getAllComments() { return [...comments]; }
async function getCommentById(commentId) { return comments.find(comment => String(comment.id) === String(commentId)) || null; }

async function createComment(message) {
  const comment = { id: generateId(), message: String(message || '').trim() };
  comments.push(comment);
  return comment;
}

module.exports = { getAllComments, getCommentById, createComment, comments };