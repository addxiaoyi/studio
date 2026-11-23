import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { downloadArchiveDay, reserveDownload } from './ops-download.mjs';

class HeadObjectCommand { constructor(input) { this.input = input; } }
class GetObjectCommand { constructor(input) { this.input = input; } }

async function archiveFixture(t, mode = 'ok') {
  const directory = await mkdtemp(join(tmpdir(), 'b2-budget-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const body = Buffer.from('this archive spans three daily allowances');
  const sha256 = createHash('sha256').update(body).digest('hex');
  const ranges = [];
  const client = { async send(command) {
    if (command instanceof HeadObjectCommand) return { ContentLength: body.length, Metadata: { sha256 }, VersionId: 'fixed-version' };
    const ledger = JSON.parse(await readFile(join(directory, 'download-budget.json'), 'utf8'));
    assert.ok(Object.values(ledger.days).reduce((a,b) => a+b, 0) > 0, 'budget must persist before sending');
    assert.equal(command.input.VersionId, 'fixed-version');
    const [, start, end] = command.input.Range.match(/^bytes=(\d+)-(\d+)$/).map(Number);
    ranges.push([start, end]);
    if (mode === 'failed') throw new Error('network interrupted');
    return { Body: Readable.from([body.subarray(start, end + 1)]), ContentLength: end-start+1,
      ContentRange: `bytes ${start}-${end}/${body.length}`, $metadata: { httpStatusCode: mode === 'ignored' ? 200 : 206 } };
  } };
  return { body, ranges, options: { directory, client, sdk: { HeadObjectCommand, GetObjectCommand }, bucket: 'backups',
    key: 'backups/fixed.tar.enc', bytes: body.length, sha256, dailyBytes: 15, rangeBytes: 7 } };
}

test('resumes across three UTC days, stays within each allowance and verifies all bytes', async t => {
  const { body, ranges, options } = await archiveFixture(t);
  const onDay = day => ({ ...options, now: () => new Date(`2026-11-${day}T02:30:00Z`) });
  assert.equal((await downloadArchiveDay(onDay(23))).downloadedBytes, 15);
  assert.equal((await downloadArchiveDay(onDay(23))).downloadedBytes, 15);
  assert.equal((await downloadArchiveDay(onDay(24))).downloadedBytes, 30);
  const complete = await downloadArchiveDay(onDay(25));
  assert.equal(complete.complete, true);
  assert.deepEqual(await readFile(complete.file), body);
  assert.equal(ranges[3][0], 15);
  assert.equal((await downloadArchiveDay(onDay(25))).reused, true);
});

test('failed requests consume their reservation and retries cannot exceed the daily limit', async t => {
  const { ranges, options } = await archiveFixture(t, 'failed');
  const today = { ...options, now: () => new Date('2026-11-23T02:30:00Z') };
  for (let attempt = 0; attempt < 3; attempt++) await assert.rejects(downloadArchiveDay(today), /network interrupted/);
  const paused = await downloadArchiveDay(today);
  assert.equal(paused.reservedBytes, 15);
  assert.deepEqual(ranges, [[0,6],[0,6],[0,0]]);
});

test('rejects unbounded responses before writing archive bytes', async t => {
  const { options } = await archiveFixture(t, 'ignored');
  await assert.rejects(downloadArchiveDay({ ...options, now: () => new Date('2026-11-23T02:30:00Z') }), /bounded download range/);
});

test('resumes a truncated response from the bytes actually saved, without refunding its budget', async t => {
  const { options } = await archiveFixture(t);
  const send = options.client.send.bind(options.client);
  let truncate = true;
  options.client.send = async command => {
    const response = await send(command);
    if (command instanceof GetObjectCommand && truncate) {
      response.Body.destroy();
      response.Body = Readable.from([Buffer.from('thi')]);
    }
    return response;
  };
  const today = { ...options, now: () => new Date('2026-11-23T02:30:00Z') };
  await assert.rejects(downloadArchiveDay(today), /incomplete download range/);
  truncate = false;
  const paused = await downloadArchiveDay(today);
  assert.equal(paused.reservedBytes, 15);
  assert.equal(paused.downloadedBytes, 11);
});

test('refuses a changed object version before fetching another range', async t => {
  const { options, ranges } = await archiveFixture(t);
  const today = { ...options, now: () => new Date('2026-11-23T02:30:00Z') };
  await downloadArchiveDay(today);
  const send = options.client.send.bind(options.client);
  options.client.send = async command => {
    const response = await send(command);
    return command instanceof HeadObjectCommand ? { ...response, VersionId: 'replacement-version' } : response;
  };
  await assert.rejects(downloadArchiveDay({ ...today, now: () => new Date('2026-11-24T02:30:00Z') }), /pinned archive/);
  assert.equal(ranges.length, 3);
});

test('does not start a range near the UTC budget reset', async t => {
  const { ranges, options } = await archiveFixture(t);
  const paused = await downloadArchiveDay({ ...options, now: () => new Date('2026-11-23T23:45:00Z') });
  assert.equal(paused.downloadedBytes, 0);
  assert.equal(ranges.length, 0);
});

test('rejects corrupt, excessive and negative reservations', () => {
  assert.throws(() => reserveDownload({ days: { '2026-11-23': -1 } }, '2026-11-23', 1));
  assert.throws(() => reserveDownload({ days: {} }, '2026-11-23', 900_000_001));
  assert.throws(() => reserveDownload({ days: {} }, '2026-11-23', 1, 1_000_000_000));
});
