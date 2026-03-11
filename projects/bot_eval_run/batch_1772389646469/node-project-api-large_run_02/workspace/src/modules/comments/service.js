const { generateId } = require('../../lib/id');

let commentsStore = [];

const addComment = async (projectId, taskId, content) => {
  const comment = { id: generateId(), projectId, taskId, content };
  commentsStore.push(comment);
  return comment;
};

const getAllComments = async (projectId, taskId) => {
  return commentsStore.filter(comment => comment.projectId === projectId && comment.taskId === taskId);
};

module.exports = { addComment, getAllComments };