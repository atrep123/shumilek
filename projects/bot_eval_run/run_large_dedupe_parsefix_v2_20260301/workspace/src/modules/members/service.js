const members = {};

async function addMember(projectId, data) {
  if (members[projectId] && members[projectId].includes(data.userId)) {
    return null;
  }
  members[projectId] = members[projectId] || [];
  members[projectId].push(data.userId);
  return { userId: data.userId, role: data.role };
}

module.exports = { addMember };