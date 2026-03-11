const router = require('express').Router({ mergeParams: true });
const membersService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', async (_req, res) => res.json({ members: await membersService.getAllMembers() }));
router.post('/', async (req, res) => {
  const userId = String(req.body?.userId || '').trim();
  const role = String(req.body?.role || '').trim();
  if (!userId || !role) return sendError(res, 400, 'BAD_REQUEST', 'User ID and role are required');
  const member = await membersService.createMember(userId, role);
  if (!member) return sendError(res, 409, 'MEMBER_DUPLICATE', 'Member already exists');
  return res.status(201).json({ member });
});

module.exports = router;
