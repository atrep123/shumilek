const express = require('express');
const service = require('./service');
const { createError } = require('../../lib/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const projects = await service.getAllProjects();
    res.status(200).json({ projects });
  } catch (error) {
    res.status(500).json(createError('internal_error', 'Internal server error'));
  }
});

router.post('/', async (req, res) => {
  try {
    const project = await service.createProject(req.body);
    res.status(201).json({ project });
  } catch (error) {
    res.status(400).json(createError('invalid_data', 'Invalid data provided'));
  }
});

router.get('/:projectId', async (req, res) => {
  try {
    const project = await service.getProjectById(req.params.projectId);
    if (!project) {
      return res.status(404).json(createError('not_found', 'Project not found'));
    }
    res.status(200).json({ project });
  } catch (error) {
    res.status(500).json(createError('internal_error', 'Internal server error'));
  }
});

module.exports = router;
