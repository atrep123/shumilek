const addComment = (req, res) => { const commentId = randomUUID(); res.json({ comment: { message: req.body.message } }); };
module.exports = { addComment };