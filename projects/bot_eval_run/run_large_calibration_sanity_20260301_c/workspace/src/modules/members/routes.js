const express = require('express');
const router = express.Router({ mergeParams: true });
const service = require('./service');

// Create a new member
router.post('/', async (req, res) => {
  if (!req.body.userId || !req.body.role) return sendError(res, 400, 'InvalidMemberData', 'User ID and role are required');
  const member = await service.createMember({ userId: req.body.userId, role: req.body.role, projectId: req.params.projectId });
  res.status(201).json({ member });
});

module.exports = router;
