const tasks = [];
const updateTaskStatus = (req, res) => {
  const taskIndex = tasks.findIndex(task => task.id === req.params.taskId);
  if (taskIndex === -1) return sendError(res, 404, 'NotFound', 'Task not found');
  tasks[taskIndex].status = req.body.status;
  res.json({ task: tasks[taskIndex] });
};
const getTasksByStatus = (req, res) => {
  const doneTasks = tasks.filter(task => task.status === 'done');
  res.json({ tasks: doneTasks });
};
module.exports = { updateTaskStatus, getTasksByStatus };