const router = require('express').Router({ mergeParams: true });
const commentsService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', async (_req, res) => res.json({ comments: await commentsService.getAllComments() }));
router.post('/', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return sendError(res, 400, 'BAD_REQUEST', 'Comment message is required');
  const comment = await commentsService.createComment(message);
  if (!comment) return sendError(res, 409, 'COMMENT_DUPLICATE', 'Comment already exists');
  const __commentValue = comment && typeof comment === 'object' && !('message' in comment) && 'content' in comment
      ? { ...comment, message: comment.content }
      : comment;
    return res.status(201).json({ comment: __commentValue });
});

module.exports = router;
