// src/modules/members/routes.js
const express = require('express');
const { sendError } = require('../../lib/errors');
const membersService = require('./service');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { userId, role } = req.body;
    if (!userId || typeof userId !== 'string' || !role || typeof role !== 'string') {
      return sendError(res, 400, 'INVALID_INPUT', 'Invalid input');
    }
    const member = await membersService.addMember(req.params.projectId, userId, role);
    res.status(201).json({ member });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') {
      return sendError(res, 404, 'PROJECT_NOT_FOUND', error.message);
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;