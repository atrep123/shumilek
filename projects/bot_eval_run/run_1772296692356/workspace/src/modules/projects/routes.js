const express = require('express');
const service = require('./service');
const { BadRequestError, NotFoundError } = require('../../lib/errors');

const router = express.Router();

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) {
    throw new BadRequestError('Name is required');
  }
  const project = service.createProject(name);
  res.status(201).json({ project });
});

router.get('/', (req, res) => {
  const projects = service.getAllProjects();
  res.json({ projects });
});

module.exports = router;
