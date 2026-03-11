// src/modules/members/routes.js
const express = require('express');
const membersService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'INVALID_INPUT', 'Invalid input');
  }
  try {
    const member = await membersService.createMember(userId, role);
    res.status(201).json({ member });
  } catch (error) {
    if (error.code === 'DUPLICATE') {
      return sendError(res, 409, error.code, error.message);
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
