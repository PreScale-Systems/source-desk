import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState } from '../lib/sales.ts';
import { defaultTallySettings } from '../lib/documents.ts';
import { readWorkspace, saveWorkspace, STORAGE, SETTINGS } from '../lib/workspace-storage.ts';

function storage(workspace: string, settings = JSON.stringify(defaultTallySettings())) {
  const values = new Map([[STORAGE, workspace], [SETTINGS, settings]]);
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test('saved workspace and ledger settings round-trip without losing records', () => {
  const data = createSeedState();
  const saved = storage('');
  assert.equal(saveWorkspace(saved, data, defaultTallySettings()), null);
  assert.deepEqual(readWorkspace(saved), { data, settings: defaultTallySettings(), recovery: null });
});

test('corrupt JSON, malformed nested records and broken references enter recovery without changing storage', () => {
  const data = createSeedState();
  for (const raw of ['{', JSON.stringify({ ...data, leads: [null] }), JSON.stringify({ ...data, orders: [{ ...data.orders[0], quoteId: 'missing' }] }), JSON.stringify({ ...data, leads: [...data.leads, data.leads[0]] })]) {
    const saved = storage(raw);
    const before = [...saved.values];
    assert.ok(readWorkspace(saved).recovery);
    assert.deepEqual([...saved.values], before);
  }
});

test('invalid ledger settings preserve the original workspace for recovery', () => {
  const saved = storage(JSON.stringify(createSeedState()), '{"companyName":123}');
  const before = [...saved.values];
  assert.ok(readWorkspace(saved).recovery);
  assert.deepEqual([...saved.values], before);
});

test('unavailable storage and quota errors produce recoverable messages', () => {
  assert.ok(readWorkspace({ getItem() { throw new Error('denied'); } }).recovery);
  assert.match(saveWorkspace({ setItem() { throw new Error('quota'); } }, createSeedState(), defaultTallySettings())!, /backup/);
  assert.deepEqual(readWorkspace({ getItem: () => null }), { data: null, settings: null, recovery: null });
});
