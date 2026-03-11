// src/modules/members/routes.js
const express = require('express');
const service = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'INVALID_INPUT', 'User ID and role are required');
  }
  try {
    const member = await service.createMember(userId, role);
    res.status(201).json({ member });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create member');
  }
});

module.exports = router;