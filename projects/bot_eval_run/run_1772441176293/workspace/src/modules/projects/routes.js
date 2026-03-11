const express = require('express');
const router = express.Router();
const projectsService = require('./service').service;

router.post('/', (req, res) => {
  if (!req.body.name) return sendError(res, 400, 'BadRequestError', 'Name is required');
  const project = projectsService.createProject(req.body.name);
  res.status(201).json({ project });
});

module.exports = { router };
