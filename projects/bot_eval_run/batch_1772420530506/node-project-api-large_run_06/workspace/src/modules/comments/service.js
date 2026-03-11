let commentsStore = [];

async function addComment(projectId, taskId, message) {
  const comment = {
    projectId,
    taskId,
    message,
  };
  commentsStore.push(comment);
  return comment;
}

async function getComments(projectId, taskId) {
  return commentsStore.filter(comment => comment.projectId === projectId && comment.taskId === taskId);
}

module.exports = {
  addComment,
  getComments,
};