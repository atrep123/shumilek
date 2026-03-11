const router = require('express').Router();
const membersService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', async (req, res) => {
  const projectId = req.params.projectId;
  if (!projectId) return sendError(res, 400, 'BAD_REQUEST', 'Project ID is required');
  const members = await membersService.getMembers(projectId);
  if (members === null) return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  return res.json({ members });
});

router.post('/', async (req, res) => {
  const projectId = req.params.projectId;
  if (!projectId) return sendError(res, 400, 'BAD_REQUEST', 'Project ID is required');
  const userId = String(req.body?.userId || '').trim();
  const role = String(req.body?.role || '').trim();
  if (!userId || !role) return sendError(res, 400, 'BAD_REQUEST', 'userId and role are required');
  const outcome = await membersService.addMember(projectId, userId, role);
  if (!outcome) return sendError(res, 409, 'MEMBER_DUPLICATE', 'Member already exists');
  if (outcome === null) return sendError(res, 409, 'MEMBER_DUPLICATE', 'Member already exists');
  return res.status(201).json({ member: outcome });
});

module.exports = router;
