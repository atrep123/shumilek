// src/modules/members/service.js
const membersStore = [];

async function addMember(projectId, userId, role) {
  const project = await getProjectById(projectId);
  if (!project) {
    throw { code: 'PROJECT_NOT_FOUND', message: 'Project not found' };
  }
  const member = { projectId, userId, role };
  membersStore.push(member);
  return member;
}

async function getProjectById(projectId) {
  // Placeholder for actual project retrieval logic
  return true; // Assuming project exists for simplicity
}

module.exports = {
  addMember,
};