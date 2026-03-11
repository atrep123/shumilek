const express = require('express');
const router = express.Router({ mergeParams: true });
const service = require('./service');
router.post('/', (req, res) => { service.addMember(req, res); });
module.exports = router;