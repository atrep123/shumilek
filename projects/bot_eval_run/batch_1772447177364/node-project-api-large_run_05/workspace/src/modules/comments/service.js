// src/modules/comments/service.js
const commentsStore = [];

async function addComment(projectId, taskId, content) {
  const project = await getProjectById(projectId);
  if (!project) {
    throw { code: 'PROJECT_NOT_FOUND', message: 'Project not found' };
  }
  const task = tasksStore.find(t => t.id === taskId && t.projectId === projectId);
  if (!task) {
    throw { code: 'TASK_NOT_FOUND', message: 'Task not found' };
  }
  const comment = { id: randomUUID(), projectId, taskId, content };
  commentsStore.push(comment);
  return comment;
}

async function getProjectById(projectId) {
  // Placeholder for actual project retrieval logic
  return true; // Assuming project exists for simplicity
}

module.exports = {
  addComment,
};