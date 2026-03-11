let members = [];
let currentId = 1;

function getAll(projectId) {
  return members.filter(m => m.projectId === projectId);
}

function create(projectId, name) {
  const member = { id: currentId++, projectId, name };
  members.push(member);
  return member;
}

module.exports = { getAll, create };
