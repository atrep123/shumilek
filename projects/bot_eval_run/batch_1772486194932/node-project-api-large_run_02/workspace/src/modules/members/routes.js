// src/modules/members/routes.js
const express = require('express');
const membersService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const members = await membersService.getAllMembers(projectId);
    res.json({ members });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.post('/', async (req, res) => {
  const { userId, role } = req.body;
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return sendError(res, 400, 'INVALID_USER_ID', 'User ID must be a non-empty string');
  }
  if (!role || typeof role !== 'string' || role.trim() === '') {
    return sendError(res, 400, 'INVALID_ROLE', 'Role must be a non-empty string');
  }

  try {
    const projectId = req.params.projectId;
    const member = await membersService.createMember(projectId, userId, role);
    res.status(201).json({ member });
  } catch (error) {
    if (error.code === 'DUPLICATE_MEMBER') {
      return sendError(res, 409, 'DUPLICATE_MEMBER', 'Member already exists');
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
