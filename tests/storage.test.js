import { describe, it, expect, beforeEach } from 'vitest';
import {
  STORAGE_KEY,
  buildStoragePayload,
  buildJsonExportPayload,
  parseJsonImport,
  saveToStorage,
  loadFromStorage,
  clearStorage,
} from '../src/state/storage.js';

// In-memory localStorage stub for the test environment.
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: k => map.delete(k),
    _map: map,
  };
}

const sampleRig = (rig, customer, days = 2) => ({
  meta: { customer, well: 'WELL-A', contract: 'C-1', po: 'PO-1' },
  rows: Array.from({ length: days }, (_, i) => ({
    date: `${String(i + 1).padStart(2, '0')}-Mar-2026`,
    operating: 24, reduced: 0, breakdown: 0,
    total_hrs: 24, _source: 'PDF',
  })),
  files: [`${rig}_file.pdf`],
});

describe('buildStoragePayload', () => {
  it('strips _source from each row', () => {
    const store = { 204: sampleRig(204, 'ARA') };
    const out = buildStoragePayload(store, 3, 2026);
    for (const row of out.rigs[204].rows) {
      expect(row).not.toHaveProperty('_source');
      expect(row.operating).toBe(24);
    }
  });

  it('omits rigs with no rows', () => {
    const store = {
      104: sampleRig(104, 'PDO'),
      204: { meta: {}, rows: [], files: [] },
    };
    const out = buildStoragePayload(store, 3, 2026);
    expect(out.rigs[104]).toBeDefined();
    expect(out.rigs[204]).toBeUndefined();
  });

  it('preserves billingMonth/billingYear and stamps savedAt as ISO', () => {
    const out = buildStoragePayload({ 104: sampleRig(104, 'PDO') }, 7, 2025);
    expect(out.billingMonth).toBe(7);
    expect(out.billingYear).toBe(2025);
    expect(typeof out.savedAt).toBe('string');
    expect(() => new Date(out.savedAt).toISOString()).not.toThrow();
  });

  it('respects allowedRigs allowlist', () => {
    const store = {
      104: sampleRig(104, 'PDO'),
      999: sampleRig(999, 'GHOST'),
    };
    const out = buildStoragePayload(store, 3, 2026, [104]);
    expect(out.rigs[104]).toBeDefined();
    expect(out.rigs[999]).toBeUndefined();
  });
});

describe('buildJsonExportPayload', () => {
  it('tags version + exportedAt + falls back to RIG_CUST for missing customer', () => {
    const store = {
      104: { meta: { well: 'A', contract: '', po: '' }, rows: [{ date: '01-Mar-2026' }], files: [] },
    };
    const out = buildJsonExportPayload(store, 3, 2026);
    expect(out.version).toBe('2.0-qc');
    expect(out.exportedAt).toBeDefined();
    // Rig 104 is PDO in RIG_CUST — fallback should kick in since meta.customer is missing
    expect(out.rigs[104].meta.customer).toBe('PDO');
  });
});

describe('parseJsonImport', () => {
  it('round-trips the export payload', () => {
    const store = { 204: sampleRig(204, 'ARA') };
    const payload = buildJsonExportPayload(store, 3, 2026);
    const parsed = parseJsonImport(JSON.stringify(payload));
    expect(parsed.count).toBe(1);
    expect(parsed.billingMonth).toBe(3);
    expect(parsed.billingYear).toBe(2026);
    expect(parsed.rigs[204]).toBeDefined();
    expect(parsed.rigs[204].rows).toHaveLength(2);
  });

  it('drops rigs not in the allowed roster', () => {
    const json = JSON.stringify({
      billingMonth: 3, billingYear: 2026,
      rigs: { 999: sampleRig(999, 'GHOST') },
    });
    const parsed = parseJsonImport(json);
    expect(parsed.count).toBe(0);
    expect(parsed.rigs[999]).toBeUndefined();
  });

  it('throws on invalid JSON (caller handles the alert)', () => {
    expect(() => parseJsonImport('{not json')).toThrow();
  });

  it('handles a payload missing the rigs key', () => {
    const parsed = parseJsonImport('{"billingMonth":3}');
    expect(parsed.count).toBe(0);
    expect(parsed.billingMonth).toBe(3);
  });

  it('falls back files to ["json-import"] when missing', () => {
    const json = JSON.stringify({
      billingMonth: 3, billingYear: 2026,
      rigs: { 204: { meta: {}, rows: [{ date: '01-Mar-2026' }] } },
    });
    const parsed = parseJsonImport(json);
    expect(parsed.rigs[204].files).toEqual(['json-import']);
  });
});

describe('localStorage I/O round-trip', () => {
  let storage;
  beforeEach(() => { storage = makeStorage(); });

  it('saveToStorage returns the rig count, loadFromStorage returns the same payload', () => {
    const store = { 104: sampleRig(104, 'PDO'), 204: sampleRig(204, 'ARA') };
    const count = saveToStorage(store, 3, 2026, storage);
    expect(count).toBe(2);

    const loaded = loadFromStorage(storage);
    expect(loaded.billingMonth).toBe(3);
    expect(loaded.billingYear).toBe(2026);
    expect(Object.keys(loaded.rigs)).toEqual(['104', '204']);
    // _source must have been stripped during save
    for (const rig of Object.values(loaded.rigs)) {
      for (const row of rig.rows) expect(row).not.toHaveProperty('_source');
    }
  });

  it('saveToStorage returns 0 when there is nothing to save and does not write', () => {
    const count = saveToStorage({}, 3, 2026, storage);
    expect(count).toBe(0);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('loadFromStorage returns null when the slot is empty', () => {
    expect(loadFromStorage(storage)).toBeNull();
  });

  it('loadFromStorage returns null on corrupt JSON instead of throwing', () => {
    storage.setItem(STORAGE_KEY, '{not valid json');
    expect(loadFromStorage(storage)).toBeNull();
  });

  it('clearStorage removes the slot', () => {
    saveToStorage({ 104: sampleRig(104, 'PDO') }, 3, 2026, storage);
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
    clearStorage(storage);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });
});
