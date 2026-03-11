const express = require('express');
const router = express.Router({ mergeParams: true });
const service = require('./service');
router.post('/', (req, res) => {
  if (!req.body.userId || !req.body.role) return sendError(res, 400, 'BadRequest', 'UserId and role are required');
  const memberId = randomUUID();
  res.json({ member: { id: memberId, userId: req.body.userId, role: req.body.role } });
});
module.exports = router;
