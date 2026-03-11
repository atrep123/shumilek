const express = require('express');
const service = require('./service');
const { errorHandler } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const comment = await service.addComment(req.params.projectId, req.params.taskId, req.body);
    res.status(201).json({ comment });
  } catch (error) {
    errorHandler(res, error);
  }
});

router.get('/', async (req, res) => {
  try {
    const comments = await service.getAllComments(req.params.projectId, req.params.taskId);
    res.status(200).json({ comments });
  } catch (error) {
    errorHandler(res, error);
  }
});

module.exports = router;
