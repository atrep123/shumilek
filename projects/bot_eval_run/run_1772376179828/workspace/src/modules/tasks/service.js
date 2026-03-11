const createTask = (req, res) => { const taskId = randomUUID(); res.json({ task: { id: taskId, title: req.body.title } }); };
module.exports = { createTask };