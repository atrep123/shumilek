const projects = [];
exports.createProject = ({ id, name }) => {
  const project = { id, name };
  projects.push(project);
  return project;
};
