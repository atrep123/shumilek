const { randomUUID } = require('node:crypto');
const projectService = require('../projects/service');

let comments = {};

function createComment(taskId, message) {
  const task = Object.values(projectService.projects).flatMap(project => project.tasks).find(task => task.id === taskId);
  if (!task) {
    return { error: { code: 'TASK_NOT_FOUND', message: 'Task not found' } };
  }
  const id = randomUUID();
  comments[id] = { id, taskId, message };
  task.comments.push(id);
  return comments[id];
}

module.exports = {
  createComment,
};
