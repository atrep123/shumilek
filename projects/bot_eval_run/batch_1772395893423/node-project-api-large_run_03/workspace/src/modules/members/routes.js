// src/modules/members/routes.js
const express = require('express');
const membersService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

// Add a member to a project
router.post('/', async (req, res) => {
  const { userId, role } = req.body;
  if (!userId || typeof userId !== 'string' || !role || typeof role !== 'string') {
    return sendError(res, 400, 'INVALID_INPUT', 'Invalid input');
  }
  try {
    const member = await membersService.addMember(req.params.projectId, userId, role);
    if (!member) {
      return sendError(res, 409, 'MEMBER_ALREADY_EXISTS', 'Member already exists in this project');
    }
    res.status(201).json({ member });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
