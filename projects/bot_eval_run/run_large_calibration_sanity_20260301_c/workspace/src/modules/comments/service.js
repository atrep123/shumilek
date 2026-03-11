const comments = [];
exports.createComment = ({ message, taskId }) => {
  const comment = { id: crypto.randomUUID(), message };
  comments.push(comment);
  return comment;
};

exports.getCommentsForTask = taskId => {
  return comments.filter(c => c.taskId === taskId);
};
