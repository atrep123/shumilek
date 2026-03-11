import express from 'express';
const router = express.Router();

router.post('/', (req, res) => { ... });
router.get('/', (req, res) => { ... });
router.use('/:projectId', (req, res, next) => { ... });

module.exports = router;
