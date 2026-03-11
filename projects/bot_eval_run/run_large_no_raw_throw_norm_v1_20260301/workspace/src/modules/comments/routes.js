import express from 'express';
const router = express.Router({ mergeParams: true });
const commentsService = require('./service');

router.post('/', (req, res) => { ... });
router.get('/', (req, res) => { ... });

module.exports = router;
