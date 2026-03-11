export function addTask(projectId, data) {
  const id = randomUUID();
  tasks.set(id, { projectId, ...data });
  return { id, ...data };
}

export function getTasks(projectId, status) {
  if (status && !['todo', 'done'].includes(status)) throw new Error('Invalid task status');
  const filteredTasks = Array.from(tasks.values()).filter(task => task.projectId === projectId);
  return status ? filteredTasks.filter(task => task.status === status) : filteredTasks;
}

export function updateTaskStatus(taskId, newStatus) {
  const task = tasks.get(taskId);
  if (!task) throw new Error('Task not found');
  task.status = newStatus;
  return { ...task };
}
