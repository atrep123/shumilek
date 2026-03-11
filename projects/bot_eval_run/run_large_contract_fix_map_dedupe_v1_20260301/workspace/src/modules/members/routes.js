const express = require('express');
const { addMember } = require('./service');
const router = express.Router({ mergeParams: true });

router.post('/', async (req, res) => {
  const member = await addMember(req.params.projectId, req.body);
  if (member) {
    res.status(201).json({ member });
  } else {
    res.status(409).json({ error: { code: 'DUPLICATE', message: 'Member already exists' } });
  }
});

module.exports = router;