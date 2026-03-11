const express = require('express');
const router = express.Router();
const { getTaskById } = require('../../lib/id');
const { sendError } = require('../../lib/errors');
const { tasksService } = require('./service');

// GET /projects/:projectId/tasks?status=done
router.get('/:projectId/tasks', async (req, res) => {
  const projectId = req.params.projectId;
  if (!projectId) return sendError(res, 400, 'BadRequestError', 'Project ID is required');
  try {
    const tasks = await tasksService.getTasksByProjectId(projectId);
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'InternalServerError', error.message);
  }
});

module.exports = router;
