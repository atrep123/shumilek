const express = require('express');
const service = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router({ mergeParams: true });

router.post('/', async (req, res) => {
  try {
    const comment = await service.addComment(req.params.projectId, req.params.taskId, req.body.message);
    res.status(201).json({ comment });
  } catch (error) {
    return sendError(res, 500, 'INTERNAL_ERROR', String(error?.message || 'Internal server error'));
  }
});

router.get('/', async (req, res) => {
  try {
    const comments = await service.getAllComments(req.params.projectId, req.params.taskId);
    res.status(200).json({ comments });
  } catch (error) {
    return sendError(res, 500, 'INTERNAL_ERROR', String(error?.message || 'Internal server error'));
  }
});

module.exports = router;
