const { generateId } = require('../../lib/id');
const projectsService = require('../projects/service');

const createComment = (projectId, taskId, comment) => {
  const project = projectsService.getProject(projectId);
  if (!project) {
    return null;
  }

  const task = project.tasks.find(t => t.id === taskId);
  if (!task) {
    return null;
  }

  const newComment = { ...comment, id: generateId() };
  if (!task.comments) {
    task.comments = [];
  }
  task.comments.push(newComment);
  projectsService.updateProject(project);

  return newComment;
};

const getAllComments = (projectId, taskId) => {
  const project = projectsService.getProject(projectId);
  if (!project) {
    return [];
  }

  const task = project.tasks.find(t => t.id === taskId);
  if (!task || !task.comments) {
    return [];
  }

  return task.comments;
};

module.exports = { createComment, getAllComments };
