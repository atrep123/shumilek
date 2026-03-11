const { BadRequestError, NotFoundError } = require('../../lib/errors');
const projectsService = require('../projects/service');

function addComment(projectId, taskId, content) {
  const project = projectsService.getAllProjects().find(p => p.id === projectId);
  if (!project) {
    throw new NotFoundError('Project not found');
  }
  const task = project.tasks.find(t => t.id === taskId);
  if (!task) {
    throw new NotFoundError('Task not found');
  }
  const comment = { id: generateId(), content };
  task.comments.push(comment);
  return comment;
}

module.exports = {
  addComment,
};
