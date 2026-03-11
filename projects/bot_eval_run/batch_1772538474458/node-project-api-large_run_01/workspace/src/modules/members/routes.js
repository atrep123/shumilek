const express = require('express');
const router = express.Router();
const membersService = require('./service');
const errors = require('../../lib/errors');

router.post('/', (req, res) => {
  const { projectId } = req.params;
  const { userId, role } = req.body;

  if (!userId || !role) {
    return errors.sendError(res, 400, 'invalid_input', 'User ID and role are required');
  }

  const member = membersService.addMember(projectId, userId, role);
  if (member === null) {
    return errors.sendError(res, 404, 'project_not_found', 'Project not found');
  } else if (member === 'duplicate') {
    return errors.sendError(res, 409, 'duplicate_member', 'Member already exists in the project');
  }

  res.status(201).json({ member });
});

router.get('/', (req, res) => {
  const { projectId } = req.params;
  const members = membersService.getMembersByProjectId(projectId);
  res.json({ members });
});

module.exports = router;
