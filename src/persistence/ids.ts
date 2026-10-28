import { randomUUID } from 'node:crypto';

const PREFIX_PATTERN = /^[a-z]{2,4}$/;

export function newId(prefix: string): string {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new Error(`Invalid identifier prefix: ${prefix}`);
  }
  return `${prefix}_${randomUUID()}`;
}
