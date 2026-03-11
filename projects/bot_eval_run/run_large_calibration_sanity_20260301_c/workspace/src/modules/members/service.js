const members = [];
exports.createMember = ({ userId, role, projectId }) => {
  const member = { id: crypto.randomUUID(), userId, role };
  members.push(member);
  return member;
};
