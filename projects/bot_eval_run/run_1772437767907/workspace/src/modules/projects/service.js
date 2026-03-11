const { getProjectById } = require('../../lib/id');
const { sendError } = require('../../lib/errors');

async function getMembersByProjectId(projectId) {
  // Implementation here
}

async function addMemberToProject(projectId, memberData) {
  // Implementation here
}

async function getTasksByProjectId(projectId) {
  // Implementation here
}

async function addTaskToProject(projectId, taskData) {
  // Implementation here
}

async function getCommentsByTaskId(taskId) {
  // Implementation here
}

async function addCommentToTask(taskId, commentData) {
  // Implementation here
}

module.exports = {
  getMembersByProjectId,
  addMemberToProject,
  getTasksByProjectId,
  addTaskToProject,
  getCommentsByTaskId,
  addCommentToTask
};
