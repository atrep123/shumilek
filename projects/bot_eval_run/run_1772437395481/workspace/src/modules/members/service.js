import { sendError } from '../../lib/errors';
import prisma from '../../../prisma/client';

export const getMembers = async (projectId) => {
  if (!projectId) return null;
  return await prisma.member.findMany({ where: { projectId } });
};

export const createMember = async ({ projectId, userId, role }) => {
  if (!userId || !role) return null;
  return await prisma.member.create({ data: { projectId, userId, role } });
};
