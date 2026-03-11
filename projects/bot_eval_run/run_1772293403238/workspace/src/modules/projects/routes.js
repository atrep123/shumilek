const express = require('express');
const service = require('./service');
const { BadRequestError } = require('../../lib/errors');

const router = express.Router();

router.get('/', (req, res) => {
  const projects = service.getAllProjects();
  res.json({ projects });
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim() === '') {
    throw new BadRequestError('Name is required');
  }
  const project = service.createProject(name);
  res.status(201).json({ project });
});

module.exports = router;
