const createProject = (req, res) => { const projectId = randomUUID(); res.json({ projectId }); };
module.exports = { createProject };