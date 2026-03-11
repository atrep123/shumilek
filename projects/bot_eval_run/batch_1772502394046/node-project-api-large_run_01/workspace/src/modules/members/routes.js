const router = require('express').Router();
const membersService = require('./service');
const { sendError } = require('../../lib/errors');
router.get('/', async (req, res) => res.json({ members: await membersService.getMembers(req.params.projectId) }));
router.post('/', async (req, res) => {
  const userId = String(req.body?.userId || '').trim();
  const role = String(req.body?.role || '').trim();
  if (!userId || !role) return sendError(res, 400, 'BAD_REQUEST', 'userId and role are required');
  const outcome = await membersService.addMember(req.params.projectId, userId, role);
  if (!outcome) return sendError(res, 409, 'MEMBER_DUPLICATE', 'Member already exists');
  if (outcome.duplicate) return sendError(res, 409, 'MEMBER_DUPLICATE', 'Member already exists');
  return res.status(201).json({ member: outcome.member });
});
module.exports = router;
