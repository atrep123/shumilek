const express = require('express');
const router = express.Router();

router.post('/projects/:projectId/tasks/:taskId/comments', (req, res) => {
  // Implement comment creation logic here
});

module.exports = router;
