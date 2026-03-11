function createComment(projectId, taskId, { message }, { projectsRepo, tasksRepo, commentsRepo, crypto }) {
  const project = projectsRepo[projectId];
  if (!project) throw { code: 'not_found', message: 'Project not found' };

  const task = tasksRepo[taskId];
  if (!task || !project.tasks.includes(taskId)) throw { code: 'not_found', message: 'Task not found' };

  const commentId = crypto.randomUUID();
  commentsRepo[commentId] = { id: commentId, message };
  task.comments.push(commentId);
  return commentsRepo[commentId];
}

function getComments(projectId, taskId, { projectsRepo, tasksRepo, commentsRepo }) {
  const project = projectsRepo[projectId];
  if (!project) throw { code: 'not_found', message: 'Project not found' };

  const task = tasksRepo[taskId];
  if (!task || !project.tasks.includes(taskId)) throw { code: 'not_found', message: 'Task not found' };

  return task.comments.map(id => commentsRepo[id]);
}

module.exports = { createComment, getComments };
