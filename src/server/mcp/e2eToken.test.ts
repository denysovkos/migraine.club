import { describe, expect, it } from 'vitest';

import { verifyE2EMcpToken } from './e2eToken';

describe('verifyE2EMcpToken', () => {
  it('reads the user, scopes and client from the token', async () => {
    await expect(verifyE2EMcpToken('e2e-mcp|u1|migraine:read migraine:write|c1')).resolves.toEqual({
      token: 'e2e-mcp|u1|migraine:read migraine:write|c1',
      clientId: 'c1',
      scopes: ['migraine:read', 'migraine:write'],
      extra: { userId: 'u1' },
    });
  });

  it('defaults the client and allows no scopes', async () => {
    await expect(verifyE2EMcpToken('e2e-mcp|u1')).resolves.toMatchObject({ clientId: 'e2e-client', scopes: [] });
  });

  it('treats other tokens as no authorization', async () => {
    await expect(verifyE2EMcpToken(undefined)).resolves.toBeUndefined();
    await expect(verifyE2EMcpToken('Bearer x')).resolves.toBeUndefined();
  });

  it('throws for the throw token', async () => {
    await expect(verifyE2EMcpToken('e2e-mcp-throw')).rejects.toThrow('verifier failed');
  });
});
