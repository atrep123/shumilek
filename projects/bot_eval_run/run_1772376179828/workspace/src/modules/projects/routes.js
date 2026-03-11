const express = require('express');
const router = express.Router();
const service = require('./service');
router.post('/', (req, res) => { service.createProject(req, res); });
module.exports = router;