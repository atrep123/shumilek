const express = require('express');
const { addMemberToProject, getMembersByProjectId } = require('./service');
const { handleError } = require('../../lib/errors');

const router = express.Router();

router.post('/', (req, res) => {
  try {
    const member = addMemberToProject(req.params.projectId, req.body);
    res.status(201).json({ member });
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/', (req, res) => {
  try {
    const members = getMembersByProjectId(req.params.projectId);
    res.status(200).json({ members });
  } catch (error) {
    handleError(res, error);
  }
});

module.exports = router;
