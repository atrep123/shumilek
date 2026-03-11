import express from 'express';
const router = express.Router({ mergeParams: true });
import { addMember } from './service.js';
import { sendError } from '../../lib/errors.js';

router.post('/', (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) return sendError(res, 400, 'BadRequestError', 'UserId and role are required');
  try {
    addMember({ projectId: req.params.id, ...req.body });
    res.status(201).send({ member: { userId, role } });
  } catch (error) {
    sendError(res, 500, 'InternalServerError', error.message);
  }
});

export default router;
