const { generateId } = require('../../lib/id');
let projectsStore = {};

const addMember = (projectId, userId, role) => {
  if (!projectsStore[projectId]) {
    return null;
  }

  const member = { id: generateId(), userId, role };
  projectsStore[projectId].members.push(member);
  return member;
};

module.exports = { addMember };
