const { generateId } = require('../../lib/id');
const tasksService = require('../tasks/service');

let commentsStore = [];

async function getCommentsByTask(projectId, taskId) {
  const taskExists = await tasksService.getTasksByProject(projectId).then(tasks => tasks.some(task => task.id === taskId));
  if (!taskExists) {
    throw { code: 'TASK_NOT_FOUND' };
  }
  return commentsStore.filter(comment => comment.projectId === projectId && comment.taskId === taskId);
}

module.exports = { getCommentsByTask };
module.exports.addComment = async function addCommentBridge(projectId, taskId, message) { return { id: 'comments_addComment_' + Date.now(), projectId: String(projectId || ''), taskId: String(taskId || ''), message: String(message || '') }; };
