const express = require('express');
const router = express.Router();
const { getProjectById } = require('../../lib/id');
const { sendError } = require('../../lib/errors');
const { getMembersByProjectId, addMemberToProject, getTasksByProjectId, addTaskToProject, getCommentsByTaskId, addCommentToTask } = require('./service');

// GET /projects/:projectId/members
router.get('/:projectId/members', async (req, res) => {
  const projectId = req.params.projectId;
  if (!projectId) return sendError(res, 400, 'BadRequestError', 'Project ID is required');
  try {
    const members = await getMembersByProjectId(projectId);
    res.json({ members });
  } catch (error) {
    sendError(res, 500, 'InternalServerError', error.message);
  }
});

// GET /projects/:projectId/tasks
router.get('/:projectId/tasks', async (req, res) => {
  const projectId = req.params.projectId;
  if (!projectId) return sendError(res, 400, 'BadRequestError', 'Project ID is required');
  try {
    const tasks = await getTasksByProjectId(projectId);
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'InternalServerError', error.message);
  }
});

// GET /projects/:projectId/tasks/:taskId/comments
router.get('/:projectId/tasks/:taskId/comments', async (req, res) => {
  const taskId = req.params.taskId;
  if (!taskId) return sendError(res, 400, 'BadRequestError', 'Task ID is required');
  try {
    const comments = await getCommentsByTaskId(taskId);
    res.json({ comments });
  } catch (error) {
    sendError(res, 500, 'InternalServerError', error.message);
  }
});

module.exports = router;
