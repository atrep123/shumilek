import { randomUUID } from 'node:crypto';

export function generateId() {
  return randomUUID();
}
