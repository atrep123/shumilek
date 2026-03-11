// src/modules/members/routes.js
const express = require('express');
const membersService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { userId, role } = req.body;
    if (!userId || typeof userId !== 'string' || !role || typeof role !== 'string') {
      return sendError(res, 400, 'INVALID_PAYLOAD', 'Invalid payload');
    }
    const newMember = await membersService.addMember(req.params.projectId, userId, role);
    if (!newMember) return sendError(res, 409, 'MEMBER_DUPLICATE', 'Member already exists');
  res.status(201).json({ member: newMember });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
