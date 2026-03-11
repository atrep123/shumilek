const tasks = [];
exports.createTask = ({ status, projectId }) => {
  const task = { id: crypto.randomUUID(), status };
  tasks.push(task);
  return task;
};

exports.updateTaskStatus = ({ taskId, newStatus }) => {
  const taskIndex = tasks.findIndex(t => t.id === taskId);
  if (taskIndex === -1) throw new Error('NotFound');
  tasks[taskIndex].status = newStatus;
  return tasks[taskIndex];
};

exports.getTasksByStatus = status => {
  return tasks.filter(t => t.status === status);
};