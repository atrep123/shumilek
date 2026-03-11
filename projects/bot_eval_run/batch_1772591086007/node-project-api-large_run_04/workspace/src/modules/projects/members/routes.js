const express = require('express');
const service = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', (req, res) => {
  const { projectId } = req.params;
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'invalid_input', 'UserId and role are required');
  }
  const member = service.addMemberToProject(projectId, userId, role);
  if (!member) {
    return sendError(res, 409, 'duplicate_member', 'User is already a member of the project');
  }
  res.status(201).json({ member });
});

module.exports = router;
