function addMemberToProject(project, userId, role) {
  const existingMember = project.members.find(member => member.userId === userId);
  if (existingMember) {
    throw { code: 'duplicate_member', message: 'Member with this user ID already exists' };
  }
  const newMember = { userId, role };
  project.members.push(newMember);
  return newMember;
}

module.exports = {
  addMemberToProject
};
