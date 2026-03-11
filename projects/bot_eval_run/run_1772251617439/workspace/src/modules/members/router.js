const express = require('express');
const memberService = require('./service');
const router = express.Router();

router.get('/', (req, res) => {
  const projectId = req.params.projectId;
  const members = memberService.getMembersByProjectId(projectId);
  res.json({ members });
});

router.post('/', (req, res, next) => {
  try {
    const member = memberService.addMember(req.params.projectId, req.body.name);
    res.status(201).json({ member });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
