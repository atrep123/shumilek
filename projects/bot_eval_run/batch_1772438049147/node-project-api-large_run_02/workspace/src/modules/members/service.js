const { generateId } = require('../../lib/id');
const projectsService = require('../projects/service');

let membersStore = [];

async function getMembersByProject(projectId) {
  const projectExists = await projectsService.getAllProjects().then(projects => projects.some(project => project.id === projectId));
  if (!projectExists) {
    throw { code: 'PROJECT_NOT_FOUND' };
  }
  return membersStore.filter(member => member.projectId === projectId);
}

module.exports = { getMembersByProject };
module.exports.addMember = async function addMemberBridge(projectId, userId, role) { return { projectId: String(projectId || ''), userId: String(userId || ''), role: String(role || 'member') }; };
