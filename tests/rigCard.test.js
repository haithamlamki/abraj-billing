import { describe, it, expect } from 'vitest';
import { buildRigCardHTML } from '../src/views/rigCard.js';

const TL_HTML = '<div class="timeline">…</div>';

describe('buildRigCardHTML', () => {
  it('includes the rig number', () => {
    const html = buildRigCardHTML(204, 'ARA', '#10b981', 20, 28, TL_HTML);
    expect(html).toContain('204');
  });

  it('includes the customer abbreviation', () => {
    const html = buildRigCardHTML(204, 'ARA', '#10b981', 20, 28, TL_HTML);
    expect(html).toContain('ARA');
  });

  it('shows dayCount/days in the days badge', () => {
    const html = buildRigCardHTML(204, 'ARA', '#10b981', 20, 28, TL_HTML);
    expect(html).toContain('20/28');
  });

  it('applies the customer color as inline style', () => {
    const html = buildRigCardHTML(104, 'PDO', '#f59e0b', 15, 28, TL_HTML);
    expect(html).toContain('#f59e0b');
    expect(html).toContain('color:#f59e0b');
  });

  it('injects the timeline HTML', () => {
    const html = buildRigCardHTML(204, 'ARA', '#10b981', 20, 28, TL_HTML);
    expect(html).toContain(TL_HTML);
  });

  it('uses r-num class for the rig number span', () => {
    const html = buildRigCardHTML(305, 'OXY', '#8b5cf6', 5, 28, TL_HTML);
    expect(html).toContain('class="r-num"');
  });

  it('uses r-cust class for the customer span', () => {
    const html = buildRigCardHTML(305, 'OXY', '#8b5cf6', 5, 28, TL_HTML);
    expect(html).toContain('class="r-cust"');
  });

  it('uses r-days class for the days span', () => {
    const html = buildRigCardHTML(305, 'OXY', '#8b5cf6', 5, 28, TL_HTML);
    expect(html).toContain('class="r-days"');
  });
});
