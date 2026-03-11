const express = require('express');
const membersService = require('./service');
const sendError = require('../../lib/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const members = await membersService.getAllMembers(req.params.projectId);
    res.json({ members });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.post('/', async (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'INVALID_INPUT', 'UserId and role are required');
  }
  try {
    const member = await membersService.addMember(req.params.projectId, userId, role);
    res.status(201).json({ member });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') {
      sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    } else {
      sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
  }
});

module.exports = router;
