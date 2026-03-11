const errors = require('../../lib/errors');
const TaskService = require('../tasks/service');
const taskService = new TaskService();

class CommentService {
  constructor() {
    this.taskComments = {};
  }

  addComment(projectId, taskId, { message }) {
    if (!message) throw new errors.BadRequestError('Message is required');
    const task = taskService.getTaskById(projectId, taskId);
    const commentId = randomUUID();
    task.comments[commentId] = { id: commentId, message };
    return { comment: task.comments[commentId] };
  }

  getComments(projectId, taskId) {
    const task = taskService.getTaskById(projectId, taskId);
    return { comments: Object.values(task.comments) };
  }
}

module.exports = CommentService;
