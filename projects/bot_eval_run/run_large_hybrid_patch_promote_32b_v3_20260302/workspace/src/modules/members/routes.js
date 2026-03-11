const express = require('express');
const service = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', (req, res) => {
  const { projectId } = req.params;
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'BAD_REQUEST', 'UserId and role are required');
  }
  const member = service.addMember(projectId, userId, role);
  if (!member) {
    return sendError(res, 409, 'CONFLICT', 'Duplicate member');
  }
  res.status(201).json({ member });
});

module.exports = router;
