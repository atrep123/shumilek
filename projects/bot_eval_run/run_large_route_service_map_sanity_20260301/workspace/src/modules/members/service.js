const members = {};
const { randomUUID } = require('node:crypto');

exports.createMember = (projectId, { userId, role }) => {
  if (!userId || !role) throw new BadRequestError('UserId and role are required');
  const id = `${projectId}-${randomUUID()}`;
  if (members[id]) return null;
  members[id] = { id, projectId, userId, role };
  return members[id];
};

exports.getMembersByProject = (projectId) => {
  const projectMembers = Object.values(members).filter(member => member.projectId === projectId);
  return projectMembers.length ? { members: projectMembers } : null;
};
