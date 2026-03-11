// src/modules/members/routes.js
const express = require('express');
const router = express.Router();
const membersService = require('./service');
const { sendError } = require('../../lib/errors');

router.post('/', async (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'Payload must include both userId and role');
  }

  try {
    const member = await membersService.addMember(req.params.projectId, { userId, role });
    if (!member) {
      return sendError(res, 409, 'DUPLICATE_MEMBER', 'Member already exists in this project');
    }
    res.status(201).json({ member });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
