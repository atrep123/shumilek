const express = require('express');
const membersService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router({ mergeParams: true });

router.post('/', (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'BadRequest', 'UserId and role are required');
  }
  const member = membersService.createMember(userId, role);
  res.status(201).json({ member });
});

router.get('/', (req, res) => {
  const members = membersService.getMembers();
  res.json({ members });
});

module.exports = router;
