const express = require('express');
const service = require('./service');
const { BadRequestError, NotFoundError } = require('../../lib/errors');

const router = express.Router();

router.post('/', (req, res) => {
  const projectId = req.params.projectId;
  const { userId, role } = req.body;
  if (!userId || !role) {
    throw new BadRequestError('UserId and role are required');
  }
  const member = service.addMember(projectId, userId, role);
  res.status(201).json({ member });
});

router.get('/', (req, res) => {
  const projectId = req.params.projectId;
  const members = service.getMembers(projectId);
  res.json({ members });
});

module.exports = router;
