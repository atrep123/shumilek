let projectsMembers = {};

const addMember = (projectId, userId, role) => {
  if (!projectsMembers[projectId]) {
    projectsMembers[projectId] = [];
  }
  const existingMember = projectsMembers[projectId].find(m => m.userId === userId);
  if (existingMember) {
    return null;
  }
  const member = { userId, role };
  projectsMembers[projectId].push(member);
  return member;
};

const getAllMembers = (projectId) => {
  return projectsMembers[projectId] || [];
};

module.exports = { addMember, getAllMembers };