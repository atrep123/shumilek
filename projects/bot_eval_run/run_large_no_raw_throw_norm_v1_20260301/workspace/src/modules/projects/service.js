const { randomUUID } = require('node:crypto');
const errors = require('../../lib/errors');

class ProjectService {
  constructor() {
    this.projects = [];
  }

  createProject(name) {
    if (!name) throw new errors.BadRequestError('Name is required');
    const project = { id: randomUUID(), name };
    this.projects.push(project);
    return project;
  }

  getProjects() {
    return this.projects;
  }

  getProjectById(projectId) {
    const project = this.projects.find(p => p.id === projectId);
    if (!project) throw new errors.NotFoundError('Project not found');
    return project;
  }
}

module.exports = ProjectService;
