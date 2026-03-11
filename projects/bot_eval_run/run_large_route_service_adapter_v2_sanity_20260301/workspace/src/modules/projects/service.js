import { randomUUID } from 'node:crypto';
import pool from '../../db.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';

export const createProject = async (name) => {
  if (!name) throw new BadRequestError('Name is required');
  const query = 'INSERT INTO projects(id, name) VALUES($1, $2) RETURNING *';
  const values = [randomUUID(), name];
  const { rows } = await pool.query(query, values);
  if (!rows[0]) throw new Error('Project creation failed');
  return rows[0];
};

export const getProjects = async () => {
  const query = 'SELECT * FROM projects';
  const { rows } = await pool.query(query);
  if (!rows) throw new NotFoundError('No projects found');
  return rows;
};
