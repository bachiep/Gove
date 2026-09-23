import { describe, expect, it } from 'vitest';

import { TokenService } from './token.service.js';

describe('TokenService', () => {
  it('issues and verifies a constrained access token', async () => {
    const service = new TokenService();
    const token = await service.issueAccessToken({
      sub: '7de52cc9-b525-425b-af54-eac10f4fc1a6',
      sid: 'f5ee322a-1d69-4aa8-91b2-d27c645de630',
      ae: 3,
    });

    await expect(service.verifyAccessToken(token)).resolves.toEqual({
      sub: '7de52cc9-b525-425b-af54-eac10f4fc1a6',
      sid: 'f5ee322a-1d69-4aa8-91b2-d27c645de630',
      ae: 3,
    });
  });

  it('rejects a tampered access token', async () => {
    const service = new TokenService();
    const token = await service.issueAccessToken({
      sub: '7de52cc9-b525-425b-af54-eac10f4fc1a6',
      sid: 'f5ee322a-1d69-4aa8-91b2-d27c645de630',
      ae: 3,
    });

    await expect(service.verifyAccessToken(`${token}x`)).rejects.toThrow();
  });
});
