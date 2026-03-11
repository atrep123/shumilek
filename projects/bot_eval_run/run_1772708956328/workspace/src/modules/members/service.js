const { generateId } = require('../../lib/id');
const members = [];

async function getAllMembers() { return [...members]; }
async function getMemberById(memberId) { return members.find(member => String(member.id) === String(memberId)) || null; }

async function createMember(userId, role) {
  const member = { id: generateId(), userId, role: String(role || '').trim() };
  members.push(member);
  return member;
}

module.exports = { getAllMembers, getMemberById, createMember, members };