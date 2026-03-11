const router = require('express').Router();
const commentsService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', async (req, res) => {
  const projectId = req.params.projectId;
  const taskId = req.params.taskId;
  if (!projectId || !taskId) return sendError(res, 400, 'BAD_REQUEST', 'Project ID and Task ID are required');
  const comments = await commentsService.getAllComments(projectId, taskId);
  if (comments === null) return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
  return res.json({ comments });
});

router.post('/', async (req, res) => {
  const projectId = req.params.projectId;
  const taskId = req.params.taskId;
  if (!projectId || !taskId) return sendError(res, 400, 'BAD_REQUEST', 'Project ID and Task ID are required');
  const message = String(req.body?.message || '').trim();
  if (!message) return sendError(res, 400, 'BAD_REQUEST', 'Message is required');
  const comment = await commentsService.addComment(projectId, taskId, message);
  if (comment === null) return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
  const __commentValue = comment && typeof comment === 'object' && !('message' in comment) && 'content' in comment
      ? { ...comment, message: comment.content }
      : comment;
    return res.status(201).json({ comment: __commentValue });
});

module.exports = router;
