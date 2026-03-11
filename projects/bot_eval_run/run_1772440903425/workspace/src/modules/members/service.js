const addMember = (req, res) => {
  if (!req.body.userId || !req.body.role) return res.status(400).json({ error: { code: 'BadRequest', message: 'UserId and role are required' } });
  const memberId = randomUUID();
  res.json({ member: { id: memberId, userId: req.body.userId, role: req.body.role } });
};
module.exports = { addMember };
