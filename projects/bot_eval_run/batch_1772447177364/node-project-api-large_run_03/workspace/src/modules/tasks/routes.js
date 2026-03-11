// src/modules/tasks/routes.js
const express = require('express');
const router = express.Router();
const service = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', async (req, res) => {
  const status = req.query.status;
  try {
    const tasks = await service.getTasks(req.params.projectId, status);
    res.json({ tasks });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
});

router.patch('/:taskId', async (req, res) => {
  const { status } = req.body;
  if (!['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'Status must be either 