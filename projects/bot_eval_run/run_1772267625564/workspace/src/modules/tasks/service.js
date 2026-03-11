function createTask(projectId, { title }, { projectsRepo, tasksRepo, crypto }) {
  const project = projectsRepo[projectId];
  if (!project) throw { code: 'not_found', message: 'Project not found' };

  const taskId = crypto.randomUUID();
  tasksRepo[taskId] = { id: taskId, title, status: 'pending', comments: [] };
  project.tasks.push(taskId);
  return tasksRepo[taskId];
}

function getTasks(projectId, status, { projectsRepo, tasksRepo }) {
  const project = projectsRepo[projectId];
  if (!project) throw { code: 'not_found', message: 'Project not found' };

  let tasks = project.tasks.map(id => tasksRepo[id]);
  if (status) {
    tasks = tasks.filter(task => task.status === status);
  }
  return tasks;
}

function updateTaskStatus(projectId, taskId, { status }, { projectsRepo, tasksRepo }) {
  const project = projectsRepo[projectId];
  if (!project) throw { code: 'not_found', message: 'Project not found' };

  const task = tasksRepo[taskId];
  if (!task || !project.tasks.includes(taskId)) throw { code: 'not_found', message: 'Task not found' };

  task.status = status;
  return task;
}

module.exports = { createTask, getTasks, updateTaskStatus };
