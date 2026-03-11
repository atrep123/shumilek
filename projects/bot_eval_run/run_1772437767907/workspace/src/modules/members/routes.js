const express = require('express');
const router = express.Router();
const membersService = require('./service').service;
router.post('/', (req, res) => {
  if (!req.body.userId || !req.body.role) return sendError(res, 400, 'BAD_REQUEST', 'UserId and role are required');
  const member = membersService.addMember(req.params.projectId, req.body);
  res.status(201).json({ member });
});
module.exports = { router };
