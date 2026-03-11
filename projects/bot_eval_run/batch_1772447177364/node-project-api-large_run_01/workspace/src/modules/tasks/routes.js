// src/modules/tasks/routes.js
const express = require('express');
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  const { description } = req.body;
  if (!description || typeof description !== 'string' || description.trim() === '') {
    return sendError(res, 400, 'INVALID_INPUT', 'Description is required and must be a non-empty string');
  }
  try {
    const task = await tasksService.createTask(req.params.projectId, description);
    res.status(201).json({ task });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

router.patch('/:taskId', async (req, res) => {
  const { status } = req.body;
  if (!status || typeof status !== 'string' || ![ 'todo', 'done' ].includes(status)) {
    return sendError(res, 400, 'INVALID_INPUT', 'Status must be either 