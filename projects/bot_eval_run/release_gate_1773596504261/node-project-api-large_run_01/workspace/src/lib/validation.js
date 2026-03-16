// src/lib/validation.js

module.exports = {
  validateProjectName(name) {
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return false;
    }
    return true;
  },

  validateMemberPayload(payload) {
    return payload && typeof payload.userId === 'string' && typeof payload.role === 'string';
  },

  validateCommentPayload(payload) {
    return payload && typeof payload.message === 'string';
  },

  validateTaskStatus(status) {
    return ['todo', 'done'].includes(status);
  }
};