const express = require('express');
const router = express.Router();
const service = require('./service');

router.post('/', (req, res) => {
  const { projectId } = req.params;
  const data = req.body;
  const result = service.addMemberToProject(projectId, data);
  if (!result || result.error) return res.status(result?.error.code || 500).json(result);
  res.status(201).json(result);
});

module.exports = router;
