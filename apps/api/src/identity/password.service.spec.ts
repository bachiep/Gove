import { describe, expect, it } from 'vitest';

import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  it('creates an Argon2id hash that verifies only the original password', async () => {
    const service = new PasswordService();
    const password = 'correct horse battery staple';
    const hash = await service.hash(password);

    expect(hash).toContain('$argon2id$');
    await expect(service.verify(hash, password)).resolves.toBe(true);
    await expect(service.verify(hash, 'another password')).resolves.toBe(false);
  });
});
