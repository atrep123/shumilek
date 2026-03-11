function addMember(projectId, member, { projectsRepo }) {
  const project = projectsRepo[projectId];
  if (!project) throw { code: 'not_found', message: 'Project not found' };

  if (project.members.includes(member)) {
    throw { code: 'duplicate_member', message: 'Member already added to the project' };
  }

  project.members.push(member);
  return project;
}

function getMembers(projectId, { projectsRepo }) {
  const project = projectsRepo[projectId];
  if (!project) throw { code: 'not_found', message: 'Project not found' };

  return project.members;
}

module.exports = { addMember, getMembers };
