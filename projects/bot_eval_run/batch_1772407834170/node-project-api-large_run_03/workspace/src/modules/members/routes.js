// src/modules/members/routes.js
const express = require('express');
const membersService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

// Create a member
router.post('/', async (req, res) => {
  const { userId, role } = req.body;
  if (!userId || typeof userId !== 'string' || !role || typeof role !== 'string') {
    return sendError(res, 400, 'INVALID_INPUT', 'Invalid input');
  }

  try {
    const member = await membersService.createMember(req.params.projectId, userId, role);
    res.status(201).json({ member });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
