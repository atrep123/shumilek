const { randomUUID } = require('node:crypto');
const projects = [];

export function createProject(name) {
  if (!name) throw new BadRequestError('Name is required');
  const project = { id: randomUUID(), name };
  projects.push(project);
  return project;
}

class BadRequestError extends Error {
  constructor(message) {
    super(message); 
    this.code = 'BadRequest';
  }
}

export { BadRequestError };
