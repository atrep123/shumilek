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
  try {
    const member = await membersService.addMember(req.params.projectId, userId, role);
    res.status(201).json({ member });
  } catch (error) {
    if (error.code === 'DUPLICATE_MEMBER') {
      return sendError(res, 409, 'DUPLICATE_MEMBER', error.message);
    }
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

module.exports = router;
