import { describe, it, expect } from 'vitest';
import {
  createRigStore, clearRigs, ensureRig, getRig,
  setRigMeta, setRigMetaFallback, addFileToRig,
  replaceRowByDate, appendRowIfNew, sortRowsByDate,
  restoreRig, aggregateStats, hasData, updateRigMetaFields,
} from '../src/state/rigStore.js';

const row = (date, operating = 24) => ({
  date, operating, reduced: 0, breakdown: 0, total_hrs: operating,
});

describe('createRigStore / ensureRig / getRig', () => {
  it('starts empty', () => {
    expect(createRigStore()).toEqual({});
  });

  it('ensureRig creates the canonical shape and returns the entry', () => {
    const s = createRigStore();
    const e = ensureRig(s, 204);
    expect(e).toEqual({ meta: {}, rows: [], files: [] });
    expect(s[204]).toBe(e);
  });

  it('ensureRig is idempotent', () => {
    const s = createRigStore();
    const a = ensureRig(s, 204);
    a.meta = { customer: 'ARA' };
    const b = ensureRig(s, 204);
    expect(b).toBe(a);
    expect(b.meta.customer).toBe('ARA');
  });

  it('getRig returns null for missing rigs', () => {
    expect(getRig(createRigStore(), 999)).toBeNull();
  });
});

describe('clearRigs', () => {
  it('removes all entries but keeps store identity', () => {
    const s = createRigStore();
    ensureRig(s, 104); ensureRig(s, 204);
    const before = s;
    clearRigs(s);
    expect(s).toBe(before);
    expect(Object.keys(s)).toHaveLength(0);
  });
});

describe('setRigMeta / setRigMetaFallback', () => {
  it('setRigMeta replaces meta wholesale', () => {
    const s = createRigStore();
    ensureRig(s, 204).meta = { customer: 'old', extra: 'x' };
    setRigMeta(s, 204, { customer: 'ARA', well: 'W1', contract: 'C', po: 'P' });
    expect(s[204].meta).toEqual({ customer: 'ARA', well: 'W1', contract: 'C', po: 'P' });
  });

  it('setRigMetaFallback prefers incoming, then existing, then RIG_CUST', () => {
    const s = createRigStore();
    setRigMeta(s, 204, { customer: '', well: 'OldWell', contract: '', po: '' });
    setRigMetaFallback(s, 204, { customer: '', well: '', contract: 'NewC', po: '' });
    // Rig 204 is ARA in RIG_CUST, well stays from existing, contract from incoming.
    expect(s[204].meta.customer).toBe('ARA');
    expect(s[204].meta.well).toBe('OldWell');
    expect(s[204].meta.contract).toBe('NewC');
  });

  it('setRigMetaFallback uses defaults when nothing else fills the slot', () => {
    const s = createRigStore();
    setRigMetaFallback(s, 999, {}, { customer: 'DEFAULT', well: 'DW' });
    // 999 is not in RIG_CUST.
    expect(s[999].meta.customer).toBe('DEFAULT');
    expect(s[999].meta.well).toBe('DW');
  });
});

describe('addFileToRig', () => {
  it('appends new filenames and ignores duplicates', () => {
    const s = createRigStore();
    ensureRig(s, 204);
    addFileToRig(s, 204, 'a.xlsx');
    addFileToRig(s, 204, 'a.xlsx');
    addFileToRig(s, 204, 'b.pdf');
    expect(s[204].files).toEqual(['a.xlsx', 'b.pdf']);
  });

  it('is a no-op for missing rig or empty filename', () => {
    const s = createRigStore();
    addFileToRig(s, 204, 'orphan.pdf'); // no entry yet
    expect(s[204]).toBeUndefined();
    ensureRig(s, 204);
    addFileToRig(s, 204, '');
    expect(s[204].files).toEqual([]);
  });
});

describe('row mutations', () => {
  it('replaceRowByDate hits the matching date and skips when none', () => {
    const s = createRigStore();
    ensureRig(s, 204).rows = [row('01-Mar-2026'), row('02-Mar-2026', 12)];
    expect(replaceRowByDate(s, 204, { ...row('02-Mar-2026', 24), tag: 'fixed' })).toBe(true);
    expect(s[204].rows[1].operating).toBe(24);
    expect(s[204].rows[1].tag).toBe('fixed');
    expect(replaceRowByDate(s, 204, row('99-Dec-2026'))).toBe(false);
  });

  it('appendRowIfNew adds new dates and skips duplicates', () => {
    const s = createRigStore();
    expect(appendRowIfNew(s, 204, row('01-Mar-2026'))).toBe(true);
    expect(appendRowIfNew(s, 204, row('01-Mar-2026'))).toBe(false);
    expect(appendRowIfNew(s, 204, row('02-Mar-2026'))).toBe(true);
    expect(s[204].rows.map(r => r.date)).toEqual(['01-Mar-2026', '02-Mar-2026']);
  });

  it('sortRowsByDate sorts chronologically', () => {
    const s = createRigStore();
    ensureRig(s, 204).rows = [
      row('15-Mar-2026'), row('01-Mar-2026'), row('10-Mar-2026'),
    ];
    sortRowsByDate(s, 204);
    expect(s[204].rows.map(r => r.date)).toEqual([
      '01-Mar-2026', '10-Mar-2026', '15-Mar-2026',
    ]);
  });

  it('sortRowsByDate is a no-op on missing rig', () => {
    const s = createRigStore();
    expect(() => sortRowsByDate(s, 999)).not.toThrow();
  });
});

describe('restoreRig', () => {
  it('writes the canonical shape and accepts partial input', () => {
    const s = createRigStore();
    restoreRig(s, 204, { meta: { customer: 'ARA' }, rows: [row('01-Mar-2026')] });
    expect(s[204].meta.customer).toBe('ARA');
    expect(s[204].rows).toHaveLength(1);
    expect(s[204].files).toEqual([]); // default

    restoreRig(s, 105, {});
    expect(s[105]).toEqual({ meta: {}, rows: [], files: [] });
  });
});

describe('aggregateStats', () => {
  it('counts only rigs with rows and sums operating hours', () => {
    const s = createRigStore();
    ensureRig(s, 104).rows = [row('01-Mar-2026', 24), row('02-Mar-2026', 12)];
    ensureRig(s, 204); // empty — should not count
    ensureRig(s, 305).rows = [row('01-Mar-2026', 18)];
    expect(aggregateStats(s)).toEqual({ rigs: 2, rows: 3, operatingHours: 54 });
  });

  it('zero on an empty store', () => {
    expect(aggregateStats(createRigStore())).toEqual({ rigs: 0, rows: 0, operatingHours: 0 });
  });
});

describe('hasData', () => {
  it('true only when the rig has at least one row', () => {
    const s = createRigStore();
    ensureRig(s, 204);
    expect(hasData(s, 204)).toBe(false);
    s[204].rows = [row('01-Mar-2026')];
    expect(hasData(s, 204)).toBe(true);
    expect(hasData(s, 999)).toBe(false);
  });
});

describe('updateRigMetaFields', () => {
  it('preserves existing well/contract/po when incoming is empty/falsy', () => {
    const s = createRigStore();
    setRigMeta(s, 104, { customer: 'PDO', well: 'W1', contract: 'C1', po: 'P1' });
    updateRigMetaFields(s, 104, { well: 'W2', contract: '', po: undefined });
    expect(s[104].meta.customer).toBe('PDO'); // not in partial → preserved
    expect(s[104].meta.well).toBe('W2');       // truthy → updated
    expect(s[104].meta.contract).toBe('C1');   // empty → preserved
    expect(s[104].meta.po).toBe('P1');         // undefined → preserved
  });

  it('writes customer even when empty (so fallback chains land in the store)', () => {
    const s = createRigStore();
    setRigMeta(s, 104, { customer: 'PDO', well: 'W1' });
    updateRigMetaFields(s, 104, { customer: '' });
    expect(s[104].meta.customer).toBe('');
    expect(s[104].meta.well).toBe('W1');
  });

  it('coerces values via safeStr', () => {
    const s = createRigStore();
    updateRigMetaFields(s, 104, { customer: '  PDO  ' });
    expect(s[104].meta.customer).toBe('PDO');
  });
});
