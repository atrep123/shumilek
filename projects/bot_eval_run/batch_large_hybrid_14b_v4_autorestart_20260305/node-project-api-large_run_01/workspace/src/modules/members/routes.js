const express = require('express');
const membersService = require('./service');

const router = express.Router({ mergeParams: true });

router.post('/', (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'User ID and role are required' } });
  }
  const member = membersService.addMember(req.params.projectId, userId, role);
  if (!member) {
    return res.status(409).json({ error: { code: 'DUPLICATE_MEMBER', message: 'Member already exists' } });
  }
  res.status(201).json({ member });
});

router.get('/', (req, res) => {
  const members = membersService.getAllMembers(req.params.projectId);
  if (!members) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  }
  res.json({ members });
});

module.exports = router;
