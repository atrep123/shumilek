module.exports = (app, { projectsRepo, membersRepo, crypto }) => {
  // Add a member to a project
  app.post('/projects/:projectId/members', (req, res) => {
    const { projectId } = req.params;
    if (!projectsRepo[projectId]) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } });

    const { name } = req.body;
    if (!name) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Name is required' } });

    const memberId = crypto.randomUUID();
    membersRepo[memberId] = { id: memberId, projectId, name };
    res.status(201).json({ member: membersRepo[memberId] });
  });

  // Get all members for a project
  app.get('/projects/:projectId/members', (req, res) => {
    const { projectId } = req.params;
    if (!projectsRepo[projectId]) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } });

    const members = Object.values(membersRepo).filter(member => member.projectId === projectId);
    res.status(200).json({ members });
  });
};
