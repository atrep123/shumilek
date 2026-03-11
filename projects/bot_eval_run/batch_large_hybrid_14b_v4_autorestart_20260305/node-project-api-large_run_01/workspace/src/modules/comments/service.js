const { randomUUID } = require('node:crypto');
let projectsComments = {};

const addComment = (projectId, taskId, content) => {
  if (!projectsComments[projectId]) {
    projectsComments[projectId] = {};
  }
  if (!projectsComments[projectId][taskId]) {
    projectsComments[projectId][taskId] = [];
  }
  const commentId = randomUUID();
  const comment = { id: commentId, content };
  projectsComments[projectId][taskId].push(comment);
  return comment;
};

const getAllComments = (projectId, taskId) => {
  if (!projectsComments[projectId] || !projectsComments[projectId][taskId]) {
    return null;
  }
  return projectsComments[projectId][taskId];
};

module.exports = { addComment, getAllComments };
