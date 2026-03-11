const express = require('express');
const router = express.Router({ mergeParams: true });
const { createMember, getMembersByProject } = require('./service');

router.post('/', async (req, res) => {
  const member = await createMember(req.params.projectId, req.body);
  if (!member) return sendError(res, 409, 'CONFLICT', 'Duplicate member');
  res.status(201).json({ member });
});

router.get('/', async (req, res) => {
  const members = await getMembersByProject(req.params.projectId);
  if (!members) return sendError(res, 404, 'NOT_FOUND', 'Project not found');
  res.json({ members });
});

module.exports = router;
