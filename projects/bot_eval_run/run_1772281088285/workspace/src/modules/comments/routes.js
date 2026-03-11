const express = require('express');
const service = require('./service');
const { createError } = require('../../lib/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const comments = await service.getAllComments(req.params.projectId, req.params.taskId);
    if (!comments) {
      return res.status(404).json(createError('not_found', 'Task not found'));
    }
    res.status(200).json({ comments });
  } catch (error) {
    res.status(500).json(createError('internal_error', 'Internal server error'));
  }
});

router.post('/', async (req, res) => {
  try {
    const comment = await service.createComment(req.params.projectId, req.params.taskId, req.body);
    if (!comment) {
      return res.status(404).json(createError('not_found', 'Task not found'));
    }
    res.status(201).json({ comment });
  } catch (error) {
    res.status(400).json(createError('invalid_data', 'Invalid data provided'));
  }
});

module.exports = router;
