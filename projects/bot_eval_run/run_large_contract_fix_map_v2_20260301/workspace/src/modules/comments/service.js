const { sendError } = require('../../lib/errors');

// Example function to handle comments
exports.handleComment = (taskId, message) => {
  if (!message) return sendError(null, 400, 'MissingMessage', 'Message is required');
  // service logic here
};