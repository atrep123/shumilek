const { randomUUID } = require('../../lib/id');

let projectsStore = [];

const addMember = (projectId, userId, role) => {
  const project = projectsStore.find(p => p.id === projectId);
  if (!project) {
    throw { code: 'PROJECT_NOT_FOUND' };
  }

  const member = {
    id: randomUUID(),
    userId,
    role,
  };
  project.members = project.members || [];
  project.members.push(member);
  return Promise.resolve(member);
};

module.exports = { addMember };
