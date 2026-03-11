import { sendError } from '../../lib/errors';
import prisma from '../../../prisma/client';

export const getComments = async (taskId) => {
  if (!taskId) return null;
  return await prisma.comment.findMany({ where: { taskId } });
};

export const createComment = async ({ taskId, message }) => {
  if (!message) return null;
  return await prisma.comment.create({ data: { taskId, message } });
};
