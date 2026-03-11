import express from 'express';
const router = express.Router({ mergeParams: true });
const tasksService = require('./service');

router.post('/', (req, res) => { ... });
router.get('/', (req, res) => { ... });
router.patch('/:taskId', (req, res) => { ... });
router.get('/?status=done', (req, res) => { ... });

module.exports = router;
