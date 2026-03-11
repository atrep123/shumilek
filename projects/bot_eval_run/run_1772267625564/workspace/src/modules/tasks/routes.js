module.exports = (app, { projectsRepo, tasksRepo, crypto }) => {
  // Create a new task for a project
  app.post('/projects/:projectId/tasks', (req, res) => {
    const { projectId } = req.params;
    if (!projectsRepo[projectId]) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } });

    const { title } = req.body;
    if (!title) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Title is required' } });

    const taskId = crypto.randomUUID();
    tasksRepo[taskId] = { id: taskId, projectId, title, status: 'pending' };
    res.status(201).json({ task: tasksRepo[taskId] });
  });

  // Get all tasks for a project
  app.get('/projects/:projectId/tasks', (req, res) => {
    const { projectId } = req.params;
    if (!projectsRepo[projectId]) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } });

    const tasks = Object.values(tasksRepo).filter(task => task.projectId === projectId);
    res.status(200).json({ tasks });
  });

  // Get tasks by status for a project
  app.get('/projects/:projectId/tasks', (req, res) => {
    const { projectId } = req.params;
    const { status } = req.query;
    if (!projectsRepo[projectId]) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } });

    const tasks = Object.values(tasksRepo).filter(task => task.projectId === projectId && task.status === status);
    res.status(200).json({ tasks });
  });

  // Update a task's status
  app.patch('/projects/:projectId/tasks/:taskId', (req, res) => {
    const { projectId, taskId } = req.params;
    if (!projectsRepo[projectId]) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } });
    if (!tasksRepo[taskId] || tasksRepo[taskId].projectId !== projectId) return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: 'Task not found' } });

    const { status } = req.body;
    if (status && ['pending', 'done'].includes(status)) {
      tasksRepo[taskId].status = status;
      res.status(200).json({ task: tasksRepo[taskId] });
    } else {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid status' } });
    }
  });
};
