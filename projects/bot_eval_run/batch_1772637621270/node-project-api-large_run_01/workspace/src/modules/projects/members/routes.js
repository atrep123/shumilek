const express = require('express');
const service = require('./service');
const { errorHandler } = require('../../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const member = await service.addMember(req.params.projectId, req.body);
    res.status(201).json({ member });
  } catch (error) {
    errorHandler(res, error);
  }
});

router.get('/', async (req, res) => {
  try {
    const members = await service.getAllMembers(req.params.projectId);
    res.json({ members: Object.values(members) });
  } catch (error) {
    errorHandler(res, error);
  }
});

module.exports = router;
