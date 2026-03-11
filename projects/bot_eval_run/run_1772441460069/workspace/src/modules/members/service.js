const membersMap = require('../../lib/sharedState').members; // Assuming shared state management

function addMember(projectId, userId, role) {
  if (!userId || !role) throw new BadRequestError('Missing required fields');
  if (membersMap.has(projectId) && membersMap.get(projectId).some(member => member.userId === userId)) {
    throw new ConflictError('User already a member of this project');
  }
  // Add member logic here
}

module.exports = { addMember };
