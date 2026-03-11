function registerRoutes(app, projectsRepo, membersRepo) {
  // Add member to project
  app.post('/projects/:projectId/members', (req, res) => {
    const { projectId } = req.params;
    if (!projectsRepo[projectId]) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } });

    const { memberId, role } = req.body;
    if (!memberId || !role) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Member ID and role are required' } });

    if (!membersRepo[projectId]) membersRepo[projectId] = {};
    membersRepo[projectId][memberId] = { id: memberId, role };
    res.status(201).json({ member: membersRepo[projectId][memberId] });
  });
}

module.exports = { registerRoutes };
