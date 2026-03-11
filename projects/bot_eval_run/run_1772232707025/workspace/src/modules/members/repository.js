function add(projectId, member) {
  const project = require('../projects/repository').getById(projectId);
  if (!project) return null;
  project.members.push(member);
  return project;
}

module.exports = { add };
