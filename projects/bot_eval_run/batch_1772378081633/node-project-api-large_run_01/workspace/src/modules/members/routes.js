const express = require('express');
const membersService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  const { userId, role } = req.body;
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return sendError(res, 400, 'INVALID_USER_ID', 'User ID must be a non-empty string');
  }
  if (!role || typeof role !== 'string' || role.trim() === '') {
    return sendError(res, 400, 'INVALID_ROLE', 'Role must be a non-empty string');
  }

  try {
    const member = await membersService.addMember(req.params.projectId, userId, role);
    res.status(201).json({ member });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') {
      return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
