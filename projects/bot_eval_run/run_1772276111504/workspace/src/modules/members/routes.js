const express = require('express');
const { addMember, getMembersByProjectId } = require('./service');
const router = express.Router();

router.post('/:projectId/members', (req, res) => {
  try {
    const member = addMember(req.params.projectId, req.body);
    res.status(201).json({ member });
  } catch (error) {
    res.status(error.code).json({ error: { code: error.code, message: error.message } });
  }
});

router.get('/:projectId/members', (req, res) => {
  try {
    const members = getMembersByProjectId(req.params.projectId);
    res.json({ members });
  } catch (error) {
    res.status(error.code).json({ error: { code: error.code, message: error.message } });
  }
});

module.exports = router;
