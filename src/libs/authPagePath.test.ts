import { describe, expect, it } from 'vitest';
import { isAuthPagePath } from './authPagePath';

describe('isAuthPagePath', () => {
  it.each([
    '/dashboard',
    '/dashboard/episodes/12',
    '/fr/dashboard',
    '/quick/attack',
    '/uk/quick/attack',
    '/quick/attack/',
  ])('matches %s', (path) => {
    expect(isAuthPagePath(path)).toBe(true);
  });

  it.each([
    '/',
    '/fr',
    '/quick/sleep',
    '/quick/attackers',
    '/dashboards',
  ])('does not match %s', (path) => {
    expect(isAuthPagePath(path)).toBe(false);
  });
});
