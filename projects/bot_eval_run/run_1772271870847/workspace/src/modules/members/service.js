const errors = require('../lib/errors');
const projectService = require('../projects/service');

let members = [];

function getMembersByProjectId(projectId) {
  projectService.getProjectById(projectId);
  return members.filter(m => m.projectId === projectId);
}

module.exports = { getMembersByProjectId };
