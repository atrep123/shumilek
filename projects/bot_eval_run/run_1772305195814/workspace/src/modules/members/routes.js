const express = require('express');
const router = express.Router();
const memberService = require('./service');
const { sendError } = require('../../lib/errors');

router.post('/', (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'INVALID_BODY', 'UserId and role are required');
  }
  const member = memberService.addMember(req.params.projectId, userId, role);
  res.status(201).json({ member });
});

module.exports = router;
