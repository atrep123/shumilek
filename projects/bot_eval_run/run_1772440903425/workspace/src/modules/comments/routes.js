const express = require('express');
const router = express.Router({ mergeParams: true });
const service = require('./service');
router.post('/', (req, res) => {
  if (!req.body.message) return sendError(res, 400, 'BadRequest', 'Message is required');
  const commentId = randomUUID();
  res.json({ comment: { id: commentId, message: req.body.message } });
});
module.exports = router;
