const tasks = {};

async function addComment(projectId, taskId, data) {
  if (!tasks[taskId]) {
    return null;
  }
  return { id: randomUUID(), ...data };
}

module.exports = { addComment };