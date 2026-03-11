const express = require('express');
const membersService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'UserId and role are required');
  }
  try {
    const member = await membersService.addMember(req.params.projectId, userId, role);
    res.json({ member });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

router.get('/', async (req, res) => {
  try {
    const members = await membersService.getMembers(req.params.projectId);
    res.json({ members });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

module.exports = router;
