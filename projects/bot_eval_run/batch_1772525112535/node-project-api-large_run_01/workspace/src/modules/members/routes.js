const express = require('express');
const router = express.Router();
const membersService = require('./service');
const { sendError } = require('../../lib/errors');

router.post('/', (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'Payload must include userId and role');
  }

  const result = membersService.addMember(req.projectId, { userId, role });
  if (result.error) {
    return sendError(res, result.status, result.error.code, result.error.message);
  }

  res.status(201).json({ member: result.member });
});

router.get('/', (req, res) => {
  const members = membersService.getMembers(req.projectId);
  res.json({ members });
});

module.exports = router;
