const express = require('express');
const router = express.Router();
const projectsService = require('./service').service;
const sendError = require('../../lib/errors').sendError;

router.get('/:projectId', (req, res) => {
  const project = projectsService.getProject(req.params.projectId);
  if (!project) return sendError(res, 404, 'E001', 'Project not found');
  res.json({ project });
});

module.exports = { router };