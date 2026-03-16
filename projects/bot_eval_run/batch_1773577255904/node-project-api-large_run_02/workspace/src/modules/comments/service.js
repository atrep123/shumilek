const { generateId } = require('../../lib/id');
const comments = [];
async function getAllComments(projectId, taskId) {
  return comments.filter(comment => String(comment.projectId) === String(projectId) && String(comment.taskId) === String(taskId));
}
async function addComment(projectId, taskId, message) {
  const comment = { id: generateId(), projectId: String(projectId), taskId: String(taskId), message: String(message || '') };
  comments.push(comment);
  return comment;
}
module.exports = { getAllComments, addComment, comments };
module.exports.createComment = module.exports.addComment;
module.exports.getComments = module.exports.getAllComments;
