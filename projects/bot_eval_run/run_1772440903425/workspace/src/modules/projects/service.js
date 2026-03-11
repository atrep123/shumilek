const projects = {};
const addProject = (projectId, name) => {
  if (!name) return null;
  projects[projectId] = { id: projectId, name };
};
const getTasksByProject = (projectId) => Object.values(projects).find(proj => proj.id === projectId)?.tasks || [];
module.exports = { addProject, getTasksByProject };
