import { describe, expect, it } from 'vitest';

import { WEBGL_COLORS } from '../tokens.generated.js';
import { CLEAN_NODE_HEX, DIM_NODE_HEX, edgeHex, nodeHex, nodeRadius } from './graph-colors.js';

describe('graph colors', () => {
  it('clean nodes use the clean color, vulnerable nodes their subtree severity', () => {
    expect(nodeHex({ subtreeWorstSeverity: null })).toBe(CLEAN_NODE_HEX);
    expect(nodeHex({ subtreeWorstSeverity: 'critical' })).toBe(WEBGL_COLORS.severityCritical);
    expect(nodeHex({ subtreeWorstSeverity: 'high' })).toBe(WEBGL_COLORS.severityHigh);
    expect(nodeHex({ subtreeWorstSeverity: 'medium' })).toBe(WEBGL_COLORS.severityMedium);
    expect(nodeHex({ subtreeWorstSeverity: 'low' })).toBe(WEBGL_COLORS.severityLow);
  });

  it('edges follow the child subtree severity, clean edges the subtle border', () => {
    expect(edgeHex(null)).toBe(WEBGL_COLORS.borderSubtle);
    expect(edgeHex('high')).toBe(WEBGL_COLORS.severityHigh);
  });

  it('the dim color is a real token, never a hand-written hex', () => {
    expect(Object.values(WEBGL_COLORS)).toContain(DIM_NODE_HEX);
  });

  it('direct dependencies render larger than transitive ones', () => {
    const direct = nodeRadius({ isDirect: true, findingCount: 0, dependentCount: 0 });
    const transitive = nodeRadius({ isDirect: false, findingCount: 0, dependentCount: 0 });
    expect(direct).toBeGreaterThan(transitive);
  });

  it('hub and finding boosts are bounded', () => {
    const huge = nodeRadius({ isDirect: true, findingCount: 500, dependentCount: 500 });
    expect(huge).toBeLessThanOrEqual(7 + 6 * 0.8 + 5 * 0.6);
    const clean = nodeRadius({ isDirect: false, findingCount: 0, dependentCount: 0 });
    expect(clean).toBe(4);
  });
});
