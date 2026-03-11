module.exports = {
  addComment(comment) {
    if (!comment || !comment.message) {
      throw new BadRequestError('Invalid comment data');
    }
    // Add comment logic here
  },
};
