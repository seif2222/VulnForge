import { describe, expect, it } from 'vitest';
import { severitySlices } from './SeverityDonut.js';
describe('severity proportions', () => {
  it('uses real counts and closes the ring', () => {
    const slices = severitySlices({ critical: 1, high: 2, medium: 3, low: 4 });
    expect(slices.map((s) => s.share)).toEqual([10, 20, 30, 40]);
    expect(slices.map((s) => s.offset)).toEqual([0, 10, 30, 60]);
  });
  it('keeps zero findings empty, never invents a segment', () => {
    expect(
      severitySlices({ critical: 0, high: 0, medium: 0, low: 0 }).every((s) => s.share === 0),
    ).toBe(true);
  });
});
