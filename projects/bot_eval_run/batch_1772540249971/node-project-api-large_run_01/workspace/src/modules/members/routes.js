const express = require('express');
const { BadRequestError, NotFoundError } = require('../../lib/errors');
const service = require('./service');

const router = express.Router({ mergeParams: true });

router.post('/', (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) {
    return sendError(res, 400, 'BAD_REQUEST', 'Invalid request body');
  }

  const member = service.addMember(req.projectId, { userId, role });
  if (!member) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to add member');
  }

  res.status(201).json({ member });
});

router.get('/', (req, res) => {
  const members = service.getMembers(req.projectId);
  if (!members) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch members');
  }

  res.json({ members });
});

module.exports = router;
