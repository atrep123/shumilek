const projects = {};

async function createTask(projectId, data) {
  if (!projects[projectId]) {
    return null;
  }
  return { id: randomUUID(), ...data };
}

module.exports = { createTask };