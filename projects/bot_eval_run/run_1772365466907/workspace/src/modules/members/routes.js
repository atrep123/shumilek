const express = require('express');
const { sendError } = require('../../lib/errors');
mconst memberService = require('./service');

const router = express.Router();

router.post('/', (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) return sendError(res, 400, 'INVALID_BODY', 'User ID and role are required');

  const projectId = req.params.projectId;
  const member = memberService.addMember(projectId, userId, role);
  if (!member) return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  if (member === 'DUPLICATE') return sendError(res, 409, 'MEMBER_EXISTS', 'Member already exists in the project');

  res.status(201).json({ member });
});

router.get('/', (req, res) => {
  const projectId = req.params.projectId;
  const members = memberService.getMembersByProject(projectId);
  if (!members) return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');

  res.json({ members });
});

module.exports = router;
