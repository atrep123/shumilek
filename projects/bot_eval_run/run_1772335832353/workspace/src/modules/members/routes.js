const express = require('express');
const membersService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router({ mergeParams: true });

router.post('/', async (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'INVALID_INPUT', 'UserId and role are required');
  }

  const member = await membersService.addMember(req.params.projectId, userId, role);
  if (!member) {
    return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  res.status(201).json({ member });
});

module.exports = router;
