// src/modules/members/routes.js
const express = require('express');
const router = express.Router();
const service = require('./service');
const { sendError } = require('../../lib/errors');

router.post('/', async (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'Payload must include userId and role');
  }
  try {
    const member = await service.createMember(userId, role);
    res.status(201).json({ member });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

module.exports = router;