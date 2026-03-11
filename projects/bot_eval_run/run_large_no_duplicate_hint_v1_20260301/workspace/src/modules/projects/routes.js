import express from 'express';
const router = express.Router();
import { addProject, getProject } from './service.js';
import { sendError } from '../../lib/errors.js';

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) return sendError(res, 400, 'BadRequestError', 'Name is required');
  try {
    addProject(name);
    res.status(201).send({ project: { id: projects.size, name } });
  } catch (error) {
    sendError(res, 500, 'InternalServerError', error.message);
  }
});

router.get('/:id', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return sendError(res, 404, 'NotFoundError', 'Project not found');
  try {
    res.send({ project });
  } catch (error) {
    sendError(res, 500, 'InternalServerError', error.message);
  }
});

export default router;
