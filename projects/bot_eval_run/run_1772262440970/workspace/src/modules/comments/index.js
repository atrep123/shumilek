const crypto = require('crypto');

function registerRoutes(app, tasksRepo, commentsRepo) {
  // Create comment for task
  app.post('/projects/:projectId/tasks/:taskId/comments', (req, res) => {
    const { projectId, taskId } = req.params;
    if (!tasksRepo[taskId] || tasksRepo[taskId].projectId !== projectId) return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: 'Task not found' } });

    const { message } = req.body;
    if (!message) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Message is required' } });

    const commentId = crypto.randomUUID();
    commentsRepo[commentId] = { id: commentId, taskId, message };
    res.status(201).json({ comment: commentsRepo[commentId] });
  });

  // List comments for task
  app.get('/projects/:projectId/tasks/:taskId/comments', (req, res) => {
    const { projectId, taskId } = req.params;
    if (!tasksRepo[taskId] || tasksRepo[taskId].projectId !== projectId) return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: 'Task not found' } });

    const comments = Object.values(commentsRepo).filter(comment => comment.taskId === taskId);
    res.status(200).json({ comments });
  });
}

module.exports = { registerRoutes };
