const express = require('express');
const router = express.Router();
const projectsService = require('./service');

router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) return sendError(res, 400, 'MissingName', 'Project name is required');
  try {
    const project = await projectsService.createProject({ name });
    return res.status(201).json({ project });
  } catch (error) {
    if (error.code === 'Duplicate') return sendError(res, 409, error.code, error.message);
    throw error;
  }
});

module.exports = router;