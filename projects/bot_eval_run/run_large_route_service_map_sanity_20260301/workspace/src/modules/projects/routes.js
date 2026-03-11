import express from 'express';
const router = express.Router();
import { createProject, getProjects } from './service.js';
import { sendError } from '../../lib/errors.js';

router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) return sendError(res, 400, 'BadRequest', 'Name is required');
  try {
    const project = await createProject(name);
    res.status(201).json({ project });
  } catch (error) {
    if (error.code === 'Duplicate') return sendError(res, 409, 'Conflict', error.message);
    sendError(res, 500, 'ServerError', error.message);
  }
});

router.get('/', async (req, res) => {
  try {
    const projects = await getProjects();
    res.json({ projects });
  } catch (error) {
    sendError(res, 500, 'ServerError', error.message);
  }
});

export default router;