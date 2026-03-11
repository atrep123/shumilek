const express = require('express');
const service = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router({ mergeParams: true });

router.post('/', async (req, res) => {
  try {
    const comment = await service.create(req.params.projectId, req.params.taskId, req.body);
    res.status(201).json({ comment });
  } catch (error) {
    return sendError(res, 500, 'INTERNAL_ERROR', String(error?.message || 'Internal server error'));
  }
});

router.get('/', async (req, res) => {
  try {
    const comments = await service.getAll(req.params.projectId, req.params.taskId);
    res.json({ comments });
  } catch (error) {
    return sendError(res, 500, 'INTERNAL_ERROR', String(error?.message || 'Internal server error'));
  }
});

module.exports = router;
