const router = require('express').Router({ mergeParams: true });
const membersService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', async (req, res) => {
  const members = await membersService.getMembers(req.params.projectId);
  if (!members) return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  res.json({ members });
});

router.post('/', async (req, res) => {
  const userId = String(req.body?.userId || '').trim();
  const role = String(req.body?.role || '').trim();
  if (!userId || !role) return sendError(res, 400, 'BAD_REQUEST', 'userId and role are required');

  const outcome = await membersService.addMember(req.params.projectId, userId, role);
  if (!outcome) return sendError(res, 409, 'MEMBER_DUPLICATE', 'Member already exists');
  if (outcome === null) return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  if (outcome.duplicate) return sendError(res, 409, 'MEMBER_DUPLICATE', 'Member already exists');

  res.status(201).json({ member: outcome.member });
});

module.exports = router;
