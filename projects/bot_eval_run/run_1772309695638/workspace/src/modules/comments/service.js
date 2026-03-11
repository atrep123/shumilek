const { randomUUID } = require('node:crypto');

let projects = {};

function addComment(projectId, taskId, comment) {
  if (!projects[projectId]) {
    projects[projectId] = {};
  }

  if (!projects[projectId][taskId]) {
    projects[projectId][taskId] = [];
  }

  const newComment = { id: randomUUID(), ...comment };
  projects[projectId][taskId].push(newComment);
  return newComment;
}

function getComments(projectId, taskId) {
  if (!projects[projectId] || !projects[projectId][taskId]) {
    return [];
  }

  return projects[projectId][taskId];
}

module.exports = {
  addComment,
  getComments,
};
