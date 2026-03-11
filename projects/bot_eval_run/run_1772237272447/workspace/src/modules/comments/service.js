const { v4: uuidv4 } = require('uuid');

function addCommentToTask(task, message) {
  const newComment = { id: uuidv4(), message };
  task.comments.push(newComment);
  return newComment;
}

module.exports = {
  addCommentToTask
};
