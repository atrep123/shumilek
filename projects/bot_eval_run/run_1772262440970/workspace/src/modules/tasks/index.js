const crypto = require('crypto');

function registerRoutes(app, projectsRepo, tasksRepo) {
  // Create task for project
  app.post('/projects/:projectId/tasks', (req, res) => {
    const { projectId } = req.params;
    if (!projectsRepo[projectId]) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } });

    const { title, description } = req.body;
    if (!title) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Title is required' } });

    const taskId = crypto.randomUUID();
    tasksRepo[taskId] = { id: taskId, projectId, title, description, status: 'pending' };
    res.status(201).json({ task: tasksRepo[taskId] });
  });

  // List tasks for project
  app.get('/projects/:projectId/tasks', (req, res) => {
    const { projectId } = req.params;
    if (!projectsRepo[projectId]) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } });

    const tasks = Object.values(tasksRepo).filter(task => task.projectId === projectId);
    res.status(200).json({ tasks });
  });

  // Get tasks by status for project
  app.get('/projects/:projectId/tasks', (req, res) => {
    const { projectId } = req.params;
    const { status } = req.query;
    if (!projectsRepo[projectId]) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } });

    const tasks = Object.values(tasksRepo).filter(task => task.projectId === projectId && task.status === status);
    res.status(200).json({ tasks });
  });

  // Update task status
  app.patch('/projects/:projectId/tasks/:taskId', (req, res) => {
    const { projectId, taskId } = req.params;
    if (!projectsRepo[projectId]) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } });

    const task = tasksRepo[taskId];
    if (!task) return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: 'Task not found' } });

    const { status } = req.body;
    if (status !== 'pending' && status !== 'done') return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid status' } });

    task.status = status;
    res.status(200).json({ task });
  });
}

module.exports = { registerRoutes };
