const addComment = (req, res) => {
  if (!req.body.message) return res.status(400).json({ error: { code: 'BadRequest', message: 'Message is required' } });
  const commentId = randomUUID();
  res.json({ comment: { id: commentId, message: req.body.message } });
};
module.exports = { addComment };
