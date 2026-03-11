const express = require('express');
const { sendError } = require('../../lib/errors');
const membersService = require('./service');

const router = express.Router();

router.post('/', (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'INVALID_INPUT', 'User ID and role are required');
  }

  const member = membersService.addMember(req.projectId, { userId, role });
  if (!member) {
    return sendError(res, 409, 'DUPLICATE_MEMBER', 'Member already exists');
  }

  res.status(201).json({ member });
});

router.get('/', (req, res) => {
  const members = membersService.getMembers(req.projectId);
  res.json({ members });
});

module.exports = router;
