const express = require('express');
const service = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'UserId and role are required');
  }
  const member = service.addMember(req.projectId, userId, role);
  res.status(201).json({ member });
});

router.get('/', (req, res) => {
  const members = service.getMembersByProjectId(req.projectId);
  res.json({ members });
});

module.exports = router;
