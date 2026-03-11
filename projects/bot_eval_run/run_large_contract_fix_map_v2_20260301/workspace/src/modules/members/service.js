const errors = require('../../lib/errors');
const membersStore = {};

exports.addMember = async ({ projectId, userId, role }) => {
  const key = `${projectId}-${userId}`;
  if (membersStore[key]) throw new errors.DuplicateError('User is already a member of this project');
  membersStore[key] = { projectId, userId, role };
  return { userId, role };
};
