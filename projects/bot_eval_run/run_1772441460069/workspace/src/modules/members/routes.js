const express = require('express');
const router = express.Router();
const { addMember } = require('./service');

router.post('/:projectId/members', async (req, res) => {
  if (!req.body.userId || !req.body.role) return sendError(res, 400, 'BAD_REQUEST', 'Invalid member data');
  const member = await addMember(req.params.projectId, req.body);
  res.status(201).json({ member });
});

module.exports = router;
