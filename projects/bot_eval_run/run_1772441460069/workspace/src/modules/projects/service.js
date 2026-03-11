const { v4: uuidv4 } = require('uuid');
const projects = [];
const getProjects = (req, res) => {
  res.json({ projects });
};
const createProject = (req, res) => {
  if (!req.body.name) return sendError(res, 400, 'BadRequest', 'Name is required');
  const project = { id: uuidv4(), name: req.body.name };
  projects.push(project);
  res.status(201).json({ project });
};
module.exports = { getProjects, createProject };