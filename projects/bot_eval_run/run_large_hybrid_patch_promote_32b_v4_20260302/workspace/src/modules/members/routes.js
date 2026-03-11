const express = require('express');
const router = express.Router();
const membersService = require('./service');
const { sendError } = require('../../lib/errors');

router.post('/', (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'Missing userId or role');
  }

  const result = membersService.addMember(req.projectId, { userId, role });
  if (result === null) {
    return sendError(res, 409, 'DUPLICATE_MEMBER', 'User is already a member of the project');
  }

  res.status(201).json({ member: result });
});

module.exports = router;
