let projects = [];

const createProject = (name) => {
  const projectId = randomUUID();
  const project = { id: projectId, name };
  projects.push(project);
  return project;
};

const getAllProjects = () => {
  return projects;
};

const getProjectById = (projectId) => {
  return projects.find(p => p.id === projectId);
};

module.exports = { createProject, getAllProjects, getProjectById };