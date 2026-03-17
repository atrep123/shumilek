const router = require('express').Router({ mergeParams: true });
const commentsService = require('./service');
const { sendError } = require('../../lib/errors');
router.get('/', async (req, res) => res.json({ comments: await commentsService.getAllComments(req.params.projectId, req.params.taskId) }));
router.post('/', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return sendError(res, 400, 'BAD_REQUEST', 'Message is required');
  const comment = await commentsService.addComment(req.params.projectId, req.params.taskId, message);
  return res.status(201).json({ comment });
});
module.exports = router;
