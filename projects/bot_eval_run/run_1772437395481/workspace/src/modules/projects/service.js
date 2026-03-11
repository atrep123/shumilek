import { randomUUID } from 'node:crypto';
import { sendError } from '../../lib/errors.js';

const projects = {};

export const createProject = (name) => {
  if (!name) return null;
  const id = randomUUID();
  projects[id] = { id, name };
  return { id, name };
};

export const getProjectById = (projectId) => projects[projectId];
