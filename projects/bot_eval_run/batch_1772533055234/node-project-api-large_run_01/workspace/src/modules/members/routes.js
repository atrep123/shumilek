const express = require('express');
const service = require('./service');
const { sendError, errorHandler } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const member = await service.addMember(req.params.projectId, req.body);
    if (!member) return sendError(res, 409, 'MEMBER_DUPLICATE', 'Member already exists');
    res.status(201).json({ member });
  } catch (error) {
    errorHandler(res, error);
  }
});

router.get('/', async (req, res) => {
  try {
    const members = await service.getAllMembers(req.params.projectId);
    if (!members) return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    res.status(200).json({ members });
  } catch (error) {
    errorHandler(res, error);
  }
});

module.exports = router;
