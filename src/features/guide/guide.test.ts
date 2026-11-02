import { describe, expect, it } from 'vitest';
import { GUIDE_PATH, isPublicPath, SECTIONS } from './guide';

describe('guide', () => {
  it('is the only page shown before signing in', () => {
    expect(isPublicPath(GUIDE_PATH)).toBe(true);
    expect(isPublicPath('/guide/')).toBe(true);
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/talk')).toBe(false);
    expect(isPublicPath('/guidebook')).toBe(false);
    expect(isPublicPath('/system/guide')).toBe(false);
  });

  it('has a table of contents whose links are unique, valid anchors', () => {
    const ids = SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z-]*$/);
    expect(SECTIONS.every((section) => section.title.length > 0)).toBe(true);
  });
});
