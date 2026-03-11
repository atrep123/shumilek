// src/modules/comments/routes.js
const express = require('express');
const service = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  const { message } = req.body;
  if (!content) {
    return sendError(res, 400, 'INVALID_INPUT', 'Message is required');
  }
  try {
    const comment = await service.createComment(content);
    res.status(201).json({ comment });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create comment');
  }
});

module.exports = router;
