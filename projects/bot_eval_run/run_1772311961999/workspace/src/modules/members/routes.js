const express = require('express');
const { sendError } = require('../../lib/errors');
membersService = require('./service');

const router = express.Router();

router.post('/', (req, res) => {
  const { projectId } = req.params;
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'INVALID_BODY', 'UserId and role are required');
  }
  const member = membersService.addMember(projectId, userId, role);
  if (!member) {
    return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  }
  res.status(201).json({ member });
});

router.get('/', (req, res) => {
  const { projectId } = req.params;
  const members = membersService.getMembers(projectId);
  if (!members) {
    return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  }
  res.json({ members });
});

module.exports = router;
