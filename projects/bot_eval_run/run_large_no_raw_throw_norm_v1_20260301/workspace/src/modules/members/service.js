const errors = require('../../lib/errors');
const ProjectService = require('../projects/service');
const projectService = new ProjectService();

class MemberService {
  constructor() {
    this.projectMembers = {};
  }

  addMember(projectId, { userId, role }) {
    if (!userId || !role) throw new errors.BadRequestError('User ID and role are required');
    const project = projectService.getProjectById(projectId);
    if (project.members.some(m => m.userId === userId)) {
      throw new errors.BadRequestError('Member already exists for this user');
    }
    project.members.push({ userId, role });
    return { member: { userId, role } };
  }

  getMembers(projectId) {
    const project = projectService.getProjectById(projectId);
    return { members: project.members };
  }
}

module.exports = MemberService;
