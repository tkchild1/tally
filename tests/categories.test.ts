import { describe, expect, it } from 'vitest';
import { categoryNameProblem, customCategoryId, DEFAULT_CATEGORIES } from '../src/lib/categories';

describe('custom categories', () => {
  it('builds a readable id and keeps it unique', () => {
    expect(customCategoryId('School & work', [])).toBe('custom-school-work');
    expect(customCategoryId('School & work', ['custom-school-work'])).toBe('custom-school-work-2');
    expect(customCategoryId('School & work', ['custom-school-work', 'custom-school-work-2'])).toBe('custom-school-work-3');
    expect(customCategoryId('Café', [])).toBe('custom-cafe');
    expect(customCategoryId('!!!', [])).toBe('custom-category');
  });

  it('never collides with a built-in id', () => {
    const ids = DEFAULT_CATEGORIES.map((c) => c.id);
    for (const c of DEFAULT_CATEGORIES) expect(ids).not.toContain(customCategoryId(c.name, ids));
  });

  it('rejects empty, too long, and duplicate names (ignoring case and spaces)', () => {
    expect(categoryNameProblem('  ', [])).toMatch(/Enter a name/);
    expect(categoryNameProblem('x'.repeat(41), [])).toMatch(/at most 40/);
    expect(categoryNameProblem(' dining ', ['Dining'])).toMatch(/already exists/);
    expect(categoryNameProblem('School & work', ['Dining'])).toBeNull();
  });
});
