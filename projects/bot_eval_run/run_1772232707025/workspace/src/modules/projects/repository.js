let projects = [];
let currentId = 1;

function getAll() {
  return projects;
}

function getById(id) {
  return projects.find(p => p.id === id);
}

function create(name) {
  const project = { id: currentId++, name, tasks: [], members: [] };
  projects.push(project);
  return project;
}

module.exports = { getAll, getById, create };
