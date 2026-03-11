const express = require('express');
const { sendError } = require('../../lib/errors');
const memberService = require('./service');

const router = express.Router();

router.post('/', (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) return sendError(res, 400, 'INVALID_INPUT', 'UserId and role are required');

  const projectId = req.params.projectId;
  const member = memberService.addMember(projectId, userId, role);
  if (!member) return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');

  res.status(201).json({ member });
});

module.exports = router;
