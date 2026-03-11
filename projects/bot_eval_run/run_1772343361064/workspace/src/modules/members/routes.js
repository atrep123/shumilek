const express = require('express');
const membersService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router({ mergeParams: true });

router.post('/', (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'BAD_REQUEST', 'UserId and role are required');
  }

  const member = membersService.addMember(req.params.projectId, userId, role);
  if (!member) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to add member');
  }

  res.status(201).json({ member });
});

router.get('/', (req, res) => {
  const members = membersService.getMembers(req.params.projectId);
  if (!members) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch members');
  }

  res.json({ members });
});

module.exports = router;
