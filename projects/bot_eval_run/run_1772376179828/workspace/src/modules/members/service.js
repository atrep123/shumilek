const addMember = (req, res) => { const memberId = randomUUID(); res.json({ member: { userId: req.body.userId, role: req.body.role } }); };
module.exports = { addMember };