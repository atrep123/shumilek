// src/modules/members/service.js
const { randomUUID } = require('node:crypto');

const membersService = {
  createMember: (userId, role) => {
    if (!userId || !role) {
      return null;
    }
    const memberId = randomUUID();
    // Simulate storing the member in a database
    return { id: memberId, userId, role };
  }
};

module.exports = membersService;
