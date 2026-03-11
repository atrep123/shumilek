const express = require('express');
const router = express.Router();
const memberService = require('./service');

router.get('/:projectId/members', (req, res) => {
  try {
    const members = memberService.getAllMembersByProjectId(req.params.projectId);
    res.status(200).json({ members });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: { code: error.code, message: error.message } });
  }
});

router.post('/:projectId/members', (req, res) => {
  try {
    const member = memberService.createMember(req.params.projectId, req.body.name);
    res.status(201).json({ member });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: { code: error.code, message: error.message } });
  }
});

module.exports = (app) => app.use('/projects', router);
