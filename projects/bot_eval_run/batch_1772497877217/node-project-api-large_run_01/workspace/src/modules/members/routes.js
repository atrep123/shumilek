// src/modules/members/routes.js
const express = require('express');
const membersService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'INVALID_INPUT', 'Both userId and role are required');
  }
  const member = await membersService.addMember(req.params.projectId, userId, role);
  if (!member) return sendError(res, 409, 'MEMBER_DUPLICATE', 'Member already exists');
  res.status(201).json({ member });
});

module.exports = router;
