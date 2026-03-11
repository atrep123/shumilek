const express = require('express');
const router = express.Router();
const projectRepository = require('../projects/repository');
const repository = require('./repository');

router.get('/:projectId/members', (req, res) => {
  const members = repository.getAll(parseInt(req.params.projectId));
  res.status(200).json({ members });
});

router.post('/:projectId/members', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: { code: 'invalid_input', message: 'Name is required' } });
  const project = projectRepository.getById(parseInt(req.params.projectId));
  if (!project) return res.status(404).json({ error: { code: 'not_found', message: 'Project not found' } });
  const member = repository.create(project.id, name);
  res.status(201).json({ member });
});

module.exports = router;
