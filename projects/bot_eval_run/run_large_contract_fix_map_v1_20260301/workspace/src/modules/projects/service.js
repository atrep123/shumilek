const { randomUUID } = require('node:crypto');
const errors = require('../../lib/errors');
const projectsStore = {};

exports.createProject = async ({ name }) => {
  if (projectsStore[name]) throw new errors.DuplicateError('User with this name already exists');
  const projectId = randomUUID();
  projectsStore[name] = { id: projectId, name };
  return { id: projectId, name };
};
