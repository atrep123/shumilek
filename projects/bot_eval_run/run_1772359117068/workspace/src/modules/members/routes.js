const express = require('express');
const router = express.Router();
const membersService = require('./service');
const { sendError } = require('../../lib/errors');

router.post('/', (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'INVALID_BODY', 'UserId and role are required');
  }
  const member = membersService.addMember(req.projectId, { userId, role });
  if (!member) {
    return sendError(res, 409, 'DUPLICATE_MEMBER', 'Member already exists');
  }
  res.status(201).json({ member });
});

module.exports = router;
