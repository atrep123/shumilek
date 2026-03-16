const { getProjectMembersById } = require('../service');

function getProjectMembersById(req, res) {
  const { projectId } = req.params;
  const members = getProjectMembersById(projectId);
  if (members) {
    res.json(members);
  } else {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project members not found' } });
  }
}

module.exports = { getProjectMembersById };
