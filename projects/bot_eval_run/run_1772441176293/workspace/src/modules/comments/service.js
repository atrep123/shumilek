const comments = [];

export function addComment(projectId, taskId, { message }) {
  if (!message) throw new BadRequestError('Message is required');
  const comment = { id: randomUUID(), projectId, taskId, message };
  comments.push(comment);
  return comment;
}

class BadRequestError extends Error {
  constructor(message) {
    super(message); 
    this.code = 'BadRequest';
  }
}

export { BadRequestError };
