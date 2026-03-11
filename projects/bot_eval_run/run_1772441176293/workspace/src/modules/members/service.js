const members = [];

export function addMember(projectId, { userId, role }) {
  if (!userId || !role) throw new BadRequestError('UserId and role are required');
  const member = { id: randomUUID(), projectId, userId, role };
  members.push(member);
  return member;
}

class BadRequestError extends Error {
  constructor(message) {
    super(message); 
    this.code = 'BadRequest';
  }
}

export { BadRequestError };
