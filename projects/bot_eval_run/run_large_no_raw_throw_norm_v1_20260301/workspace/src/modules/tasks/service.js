const errors = require('../../lib/errors');
const ProjectService = require('../projects/service');
const projectService = new ProjectService();

class TaskService {
  constructor() {
    this.tasks = {};
  }

  createTask(projectId, { title, description }) {
    const project = projectService.getProjectById(projectId);
    const taskId = randomUUID();
    project.tasks[taskId] = { id: taskId, status: 'todo', title, description };
    return { task: project.tasks[taskId] };
  }

  updateTaskStatus(projectId, taskId, newStatus) {
    if (newStatus !== 'todo' && newStatus !== 'done') throw new errors.BadRequestError('Invalid status');
    const project = projectService.getProjectById(projectId);
    const task = project.tasks[taskId];
    if (!task) throw new errors.NotFoundError('Task not found');
    task.status = newStatus;
    return { task };
  }

  getTasksByStatus(projectId, status) {
    const project = projectService.getProjectById(projectId);
    if (status === 'done') {
      return { tasks: Object.values(project.tasks).filter(t => t.status === 'done') };
    }
    throw new errors.BadRequestError('Invalid status filter');
  }
}

module.exports = TaskService;
