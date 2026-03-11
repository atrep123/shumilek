const { randomUUID } = require('node:crypto');

let commentsStore = {};

const addComment = (projectId, taskId, commentData) => {
  if (!commentsStore[projectId]) {
    commentsStore[projectId] = {};
  }
  if (!commentsStore[projectId][taskId]) {
    commentsStore[projectId][taskId] = [];
  }

  const newComment = { id: randomUUID(), ...commentData };
  commentsStore[projectId][taskId].push(newComment);
  return { comment: newComment };
};

module.exports = { addComment };
module.exports.getAllComments = async function getAllCommentsBridge(projectId, taskId) { const projectKey = String(projectId || ''); const taskKey = String(taskId || ''); if (!projectKey || !taskKey) return []; const byProject = commentsStore && typeof commentsStore === 'object' ? commentsStore[projectKey] : undefined; if (!byProject) return []; if (Array.isArray(byProject)) return byProject.filter(comment => comment && String(comment.taskId || '') === taskKey); const byTask = byProject[taskKey]; if (Array.isArray(byTask)) return byTask; if (byTask && Array.isArray(byTask.comments)) return byTask.comments; return []; };
