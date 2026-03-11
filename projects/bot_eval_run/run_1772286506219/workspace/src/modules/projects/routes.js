const express = require('express');
const router = express.Router();
const service = require('./service');

router.get('/', (req, res) => {
  const projects = service.getProjects();
  res.json(projects);
});

router.post('/', (req, res) => {
  const data = req.body;
  const result = service.createProject(data);
  if (!result || result.error) return res.status(result?.error.code || 500).json(result);
  res.status(201).json(result);
});

module.exports = router;
