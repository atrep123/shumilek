const express = require('express');
const { getMembersByProjectId } = require('./service');

const router = express.Router();

router.get('/:projectId/members', (req, res) => {
  const { projectId } = req.params;
  try {
    const members = getMembersByProjectId(projectId);
    res.json({ members });
  } catch (error) {
    res.status(404).json({ error: { code: 'not_found', message: 'Project not found' } });
  }
});

module.exports = router;
