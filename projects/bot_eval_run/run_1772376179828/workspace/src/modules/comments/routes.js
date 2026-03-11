const express = require('express');
const router = express.Router({ mergeParams: true });
const service = require('./service');
router.post('/', (req, res) => { service.addComment(req, res); });
module.exports = router;