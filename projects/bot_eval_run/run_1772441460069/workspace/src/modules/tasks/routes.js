const express = require('express');
const router = express.Router({ mergeParams: true });
const { updateTaskStatus, getTasksByStatus } = require('./service');
router.patch('/', updateTaskStatus);
router.get('/', getTasksByStatus);
module.exports = router;