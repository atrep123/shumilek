const express = require('express');
const membersService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'INVALID_INPUT', 'UserId and role are required');
  }
  try {
    const member = await membersService.addMember(req.params.projectId, userId, role);
    res.status(201).json({ member });
  } catch (error) {
    if (error.code === 'DUPLICATE_MEMBER') {
      return sendError(res, 409, 'DUPLICATE_MEMBER', 'Member already exists in this project');
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to add member');
  }
});

module.exports = router;
