const express = require('express');
const router = express.Router({ mergeParams: true });
const membersService = require('./service');

router.post('/', async (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) return sendError(res, 400, 'InvalidMemberData', 'User ID and role are required');
  try {
    const member = await membersService.addMember({ projectId: req.params.projectId, userId, role });
    return res.status(201).json({ member });
  } catch (error) {
    if (error.code === 'Duplicate') return sendError(res, 409, error.code, error.message);
    throw error;
  }
});

module.exports = router;