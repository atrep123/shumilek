const express = require('express');
const service = require('./service');

const router = express.Router();

router.post('/:projectId', (req, res) => {
  try {
    const member = service.addMember(req.params.projectId, req.body);
    res.status(201).json({ member });
  } catch (error) {
    res.status(error.code === 'not_found' ? 404 : 400).json({ error: { code: error.code, message: error.message } });
  }
});

module.exports = router;
