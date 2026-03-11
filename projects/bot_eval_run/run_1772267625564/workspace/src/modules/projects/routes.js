module.exports = (app, { projectsRepo, crypto }) => {
  // Create a new project
  app.post('/projects', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Name is required' } });
    if (Object.values(projectsRepo).some(p => p.name === name)) return res.status(409).json({ error: { code: 'DUPLICATE_PROJECT', message: 'Project with this name already exists' } });

    const projectId = crypto.randomUUID();
    projectsRepo[projectId] = { id: projectId, name };
    res.status(201).json({ project: projectsRepo[projectId] });
  });

  // Get all projects
  app.get('/projects', (req, res) => {
    const projects = Object.values(projectsRepo);
    res.status(200).json({ projects });
  });

  // Get a project by ID
  app.get('/projects/:projectId', (req, res) => {
    const { projectId } = req.params;
    if (!projectsRepo[projectId]) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } });

    res.status(200).json({ project: projectsRepo[projectId] });
  });
};
