export function addProject(name) {
  if (!name) throw new Error('Name is required');
  const id = randomUUID();
  projects.set(id, { id, name });
  return { id, name };
}

export function getProject(projectId) {
  const project = projects.get(projectId);
  if (!project) throw new Error('Project not found');
  return project;
}
