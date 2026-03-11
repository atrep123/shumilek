const { v4: uuidv4 } = require('uuid');

function addTaskToProject(project, title) {
  const existingTask = project.tasks.find(task => task.title === title);
  if (existingTask) {
    throw { code: 'duplicate_task', message: 'Task with this title already exists' };
  }
  const newTask = { id: uuidv4(), title, status: 'todo', comments: [] };
  project.tasks.push(newTask);
  return newTask;
}

function updateTaskStatus(project, taskId, status) {
  const task = project.tasks.find(task => task.id === taskId);
  if (!task) {
    throw { code: 'not_found', message: 'Task not found' };
  }
  task.status = status;
  return task;
}

module.exports = {
  addTaskToProject,
  updateTaskStatus
};
