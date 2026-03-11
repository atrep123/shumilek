const express = require('express');
const service = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router({ mergeParams: true });

router.post('/', async (req, res) => {
  try {
    const member = await service.addMember(req.params.projectId, req.body.userId, req.body.role);
    if (!member) return sendError(res, 409, 'MEMBER_DUPLICATE', 'Member already exists');
  res.status(201).json({ member });
  } catch (error) {
    return sendError(res, 500, 'INTERNAL_ERROR', String(error?.message || 'Internal server error'));
  }
});

router.get('/', async (req, res) => {
  try {
    const members = await service.getAllMembers(req.params.projectId);
    res.status(200).json({ members });
  } catch (error) {
    return sendError(res, 500, 'INTERNAL_ERROR', String(error?.message || 'Internal server error'));
  }
});

module.exports = router;
