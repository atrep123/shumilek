const express = require('express');
const { addMember, listMembers } = require('./service');

const router = express.Router();

// Add a member to a project
router.post('/', async (req, res) => {
  try {
    const member = await addMember(req.params.projectId, req.body);
    res.status(201).json(member);
  } catch (error) {
    if (error.code === 'DUPLICATE') {
      return res.status(409).json({ error: { code: 'DUPLICATE', message: error.message } });
    }
    res.status(400).json({ error: { code: 'INVALID_INPUT', message: error.message } });
  }
});

// List all members of a project
router.get('/', async (req, res) => {
  try {
    const members = await listMembers(req.params.projectId);
    res.json(members);
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

module.exports = router;