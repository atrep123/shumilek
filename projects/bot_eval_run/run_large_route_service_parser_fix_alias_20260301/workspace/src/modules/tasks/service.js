import pool from '../../db.js';
import { randomUUID } from 'node:crypto';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';

export const createTask = async (projectId, title, status) => {
  if (!title || !status) throw new BadRequestError('Title and status are required');
  const query = 'INSERT INTO tasks(id, project_id, title, status) VALUES($1, $2, $3, $4) RETURNING *';
  const values = [randomUUID(), projectId, title, status];
  const { rows } = await pool.query(query, values);
  if (!rows[0]) throw new Error('Task creation failed');
  return rows[0];
};

export const getTasksByStatus = async (projectId, status) => {
  let query;
  if (status) {
    query = 'SELECT * FROM tasks WHERE project_id = $1 AND status = $2';
  } else {
    query = 'SELECT * FROM tasks WHERE project_id = $1';
  }
  const { rows } = await pool.query(query, [projectId, status]);
  if (!rows || rows.length === 0) throw new NotFoundError('No tasks found for the given status');
  return rows;
};
