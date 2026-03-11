const express = require('express');
const router = express.Router();
const { sendError } = require('../../lib/errors');

router.post('/:taskId', (req, res) => {
  const taskId = req.params.taskId;
  if (!req.body.message) return sendError(res, 400, 'MissingMessage', 'Message is required');
  // service logic here
});

router.get('/:taskId', (req, res) => {
  const taskId = req.params.taskId;
  // service logic here
});

module.exports = router;