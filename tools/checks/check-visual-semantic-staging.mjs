#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { createClient } from '@supabase/supabase-js';
import { createOcrProbePng } from './ocr-staging-contract.mjs';

const MODEL = 'gemini-embedding-2';
const BUCKET = 'documents';
const RETRY_MS = [0, 5_000, 20_000, 60_000];
const WAIT_MS = 6 * 60_000;
const POLL_MS = 4_000;
const JPEG_BYTES = Uint8Array.from(Buffer.from(
  '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',
  'base64'
));
const PNG_SIG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function client() {
  return createClient(env('STAGING_SUPABASE_URL'), env('STAGING_SUPABASE_PUBLISHABLE_KEY'), {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false }
  });
}

async function login(db) {
  const result = await db.auth.signInWithPassword({
    email: env('STAGING_AUTHORIZED_EMAIL'), password: env('STAGING_AUTHORIZED_PASSWORD')
  });
  if (result.error || !result.data.user) throw new Error(`Sign-in failed: ${result.error?.message ?? 'no user'}`);
  const allowed = await db.rpc('is_authorized_user');
  if (allowed.error || allowed.data !== true) throw new Error('Staging user is not authorized');
  return result.data.user;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  Buffer.from(type, 'ascii').copy(out, 4);
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function patternPng(kind) {
  const w = 640, h = 420, pixels = Buffer.alloc(w * h, 255);
  const dot = (x, y) => { if (x >= 0 && y >= 0 && x < w && y < h) pixels[y * w + x] = 0; };
  const line = (x0, y0, x1, y1, t = 4) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i += 1) {
      const x = Math.round(x0 + (x1 - x0) * i / steps), y = Math.round(y0 + (y1 - y0) * i / steps);
      for (let dx = -t; dx <= t; dx += 1) for (let dy = -t; dy <= t; dy += 1) dot(x + dx, y + dy);
    }
  };
  const rect = (x, y, rw, rh) => { line(x, y, x + rw, y); line(x + rw, y, x + rw, y + rh); line(x + rw, y + rh, x, y + rh); line(x, y + rh, x, y); };
  if (kind === 'table') {
    rect(70, 55, 500, 310);
    for (const x of [195, 320, 445]) line(x, 55, x, 365, 2);
    for (const y of [132, 210, 287]) line(70, y, 570, y, 2);
  } else if (kind === 'flow') {
    rect(45, 160, 140, 90); rect(250, 65, 140, 90); rect(455, 160, 140, 90);
    line(185, 205, 250, 110); line(390, 110, 455, 205); line(455, 245, 185, 245);
  } else throw new Error(`Unknown pattern ${kind}`);
  const scan = Buffer.alloc((w + 1) * h, 255);
  for (let y = 0; y < h; y += 1) { scan[y * (w + 1)] = 0; pixels.copy(scan, y * (w + 1) + 1, y * w, (y + 1) * w); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Uint8Array.from(Buffer.concat([Buffer.from(PNG_SIG), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(scan)), chunk('IEND', Buffer.alloc(0))]));
}

function retryLater(data, pageId) {
  return data?.state === 'partial' && Array.isArray(data.pendingPageIds) && data.pendingPageIds.length === 1 && data.pendingPageIds[0] === pageId && Array.isArray(data.failedPageIds) && data.failedPageIds.length === 0;
}
async function runOcr(db, pageId) {
  let result;
  for (const delay of RETRY_MS) {
    if (delay) await sleep(delay);
    result = await db.functions.invoke('process-ocr', { body: { pageIds: [pageId] } });
    if (result.error || !retryLater(result.data, pageId)) break;
  }
  if (result?.error) throw new Error(`OCR failed: ${result.error.message}`);
}

async function makeProbe(db, userId, notebookId, id, bytes, mimeType) {
  const documentId = randomUUID(), pageId = randomUUID(), jobId = randomUUID();
  const path = `${userId}/staging-probes/${documentId}.png`;
  const upload = await db.storage.from(BUCKET).upload(path, bytes, { cacheControl: '0', contentType: mimeType, upsert: false });
  if (upload.error) throw new Error(`${id} upload failed: ${upload.error.message}`);
  const meta = await db.rpc('create_ocr_staging_probe', {
    target_document_id: documentId, target_page_id: pageId, target_job_id: jobId,
    image_storage_path: path, prepared_sha256: hash(bytes), prompt_version: 1
  });
  if (meta.error) throw new Error(`${id} metadata failed: ${meta.error.message}`);
  if (notebookId) {
    const update = await db.from('documents').update({ notebook_id: notebookId, title: `__visual_${id}__` }).eq('id', documentId);
    if (update.error) throw new Error(`${id} notebook assignment failed: ${update.error.message}`);
  }
  await runOcr(db, pageId);
  const page = await db.from('pages').select('status').eq('id', pageId).single();
  if (page.error || !['ready', 'needs_review'].includes(page.data?.status)) throw new Error(`${id} OCR did not finish successfully`);
  return { id, documentId, pageId, path, mimeType, sha256: hash(bytes) };
}

async function queue(db, probe) {
  const startedAt = Date.now();
  const result = await db.rpc('queue_page_visual_embedding_job', {
    target_page_id: probe.pageId, target_model: MODEL, target_media_path: probe.path,
    target_mime_type: probe.mimeType, target_routing_reason: 'staging_benchmark', target_routing_version: 'visual-v1'
  });
  if (result.error || result.data?.queued !== true) throw new Error(`${probe.id} visual queue failed: ${result.error?.message ?? 'not queued'}`);
  return startedAt;
}

async function waitVisual(db, probes, queuedAt) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const result = await db.from('page_visual_embeddings').select('page_id,source_hash,model').in('page_id', probes.map((p) => p.pageId));
    if (result.error) throw new Error(`Visual verification failed: ${result.error.message}`);
    if (result.data?.length === probes.length) {
      return probes.map((probe) => {
        const row = result.data.find((item) => item.page_id === probe.pageId);
        if (row?.source_hash !== probe.sha256 || row?.model !== MODEL) throw new Error(`${probe.id} hash/model mismatch`);
        return { id: probe.id, mimeType: probe.mimeType, hashMatched: true, latencyMs: Date.now() - queuedAt.get(probe.pageId) };
      });
    }
    await sleep(POLL_MS);
  }
  const stats = await db.rpc('visual_embedding_stats', { target_model: MODEL });
  const row = Array.isArray(stats.data) ? stats.data[0] : stats.data;
  throw new Error(`Visual timeout pending=${row?.pending_jobs ?? '?'} failed=${row?.failed_jobs ?? '?'}`);
}

async function waitText(db, notebookId, count) {
  const deadline = Date.now() + WAIT_MS;
  let last = {};
  while (Date.now() < deadline) {
    const result = await db.rpc('semantic_index_stats', { target_model: MODEL, notebook_filter: notebookId });
    if (result.error) throw new Error(`Text index stats failed: ${result.error.message}`);
    last = Array.isArray(result.data) ? result.data[0] : result.data;
    if (Number(last?.total_pages) === count && Number(last?.indexed_pages) === count) return { totalPages: count, indexedPages: count };
    await sleep(POLL_MS);
  }
  throw new Error(`Text index timeout ${last?.indexed_pages ?? 0}/${last?.total_pages ?? 0}`);
}

const QUERIES = [
  { id: 'lexical', expected: 'lexical', kind: 'lexical', query: 'FICHARIO OCR 2718' },
  { id: 'table', expected: 'table', kind: 'visual', query: 'uma grade com células organizadas em linhas e colunas' },
  { id: 'flow', expected: 'flow', kind: 'visual', query: 'um fluxograma com caixas conectadas por setas' },
  { id: 'negative', expected: null, kind: 'negative', query: 'uma fotografia de cachorro correndo na praia' }
];
async function searches(db, state, expectedMode) {
  const labels = new Map(state.probes.map((p) => [p.documentId, p.id]));
  const rows = [];
  for (const spec of QUERIES) {
    const start = performance.now();
    const result = await db.functions.invoke('semantic-search', { body: { query: spec.query, notebookId: state.notebookId, limit: 10, offset: 0 } });
    if (result.error || !Array.isArray(result.data?.results)) throw new Error(`${spec.id} search failed: ${result.error?.message ?? 'invalid response'}`);
    if (result.data.mode !== expectedMode) throw new Error(`${spec.id} expected ${expectedMode}, got ${result.data.mode}`);
    rows.push({ id: spec.id, kind: spec.kind, expected: spec.expected, latencyMs: Math.round(performance.now() - start), resultLabels: result.data.results.map((r) => labels.get(r.documentId)).filter(Boolean), reason: result.data.reason ?? null });
  }
  return rows;
}
function metric(rows) {
  const positives = rows.filter((r) => r.expected), visual = positives.filter((r) => r.kind === 'visual');
  const rank = (r) => { const i = r.resultLabels.indexOf(r.expected); return i < 0 ? null : i + 1; };
  const recall = (list, k) => list.filter((r) => (rank(r) ?? 999) <= k).length / list.length;
  const mrr = (list) => list.reduce((sum, r) => sum + (rank(r) ? 1 / rank(r) : 0), 0) / list.length;
  const times = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
  return { recallAt1: recall(positives, 1), recallAt3: recall(positives, 3), mrr: mrr(positives), visualMrr: mrr(visual), lexicalTop: rank(rows.find((r) => r.kind === 'lexical')) === 1, negativeCount: rows.find((r) => r.kind === 'negative')?.resultLabels.length ?? 0, latencyMedianMs: times[Math.floor(times.length / 2)] ?? 0, latencyP95Ms: times.at(-1) ?? 0 };
}

async function setup(db, user, statePath, reportPath) {
  const notebookId = randomUUID();
  const notebook = await db.from('notebooks').insert({ id: notebookId, user_id: user.id, name: `__visual_benchmark_${notebookId.slice(0, 8)}` });
  if (notebook.error) throw new Error(`Notebook failed: ${notebook.error.message}`);
  const state = { notebookId, probes: [], jpegSmoke: null };
  await writeFile(statePath, JSON.stringify(state));
  for (const [id, bytes] of [['lexical', createOcrProbePng(`visual-${randomUUID()}`)], ['table', patternPng('table')], ['flow', patternPng('flow')]]) {
    const probe = await makeProbe(db, user.id, notebookId, id, bytes, 'image/png');
    state.probes.push(probe); await writeFile(statePath, JSON.stringify(state)); await sleep(5_000);
  }
  const jpegSeed = await makeProbe(db, user.id, null, 'jpeg-smoke', createOcrProbePng(`jpeg-${randomUUID()}`), 'image/png');
  const replaced = await db.storage.from(BUCKET).update(jpegSeed.path, JPEG_BYTES, { contentType: 'image/jpeg', cacheControl: '0', upsert: true });
  if (replaced.error) throw new Error(`JPEG replacement failed: ${replaced.error.message}`);
  const jpeg = { ...jpegSeed, mimeType: 'image/jpeg', sha256: hash(JPEG_BYTES) };
  state.jpegSmoke = jpeg; await writeFile(statePath, JSON.stringify(state));
  const all = [...state.probes, jpeg], queuedAt = new Map();
  for (const probe of all) queuedAt.set(probe.pageId, await queue(db, probe));
  const visual = await waitVisual(db, all, queuedAt);
  const textIndex = await waitText(db, notebookId, state.probes.length);
  const observations = await searches(db, state, 'hybrid');
  const report = { phase: 'shadow', status: 'pass', visual, textIndex, observations, metrics: metric(observations), quotaSignalObserved: observations.some((r) => r.reason === 'semantic_quota_or_rate_limit'), pricing: { asOf: '2026-08-14', imageInputs: all.length, freeTierEstimatedUsd: 0, paidStandardEstimatedUsd: Number((all.length * 0.00012).toFixed(6)), billingTierKnown: false } };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`PASS shadow corpus + PNG/JPEG visual smoke: ${all.length} images`);
}

async function measure(db, statePath, reportPath) {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const observations = await searches(db, state, 'multimodal');
  const report = { phase: 'active', status: 'pass', observations, metrics: metric(observations), quotaSignalObserved: observations.some((r) => r.reason === 'semantic_quota_or_rate_limit') };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log('PASS active multimodal search measured');
}

async function compare(shadowPath, activePath, reportPath) {
  const shadow = JSON.parse(await readFile(shadowPath, 'utf8')), active = JSON.parse(await readFile(activePath, 'utf8'));
  const gates = { noQuotaSignal: !shadow.quotaSignalObserved && !active.quotaSignalObserved, noRecallRegression: active.metrics.recallAt3 >= shadow.metrics.recallAt3, visualImproved: active.metrics.visualMrr >= shadow.metrics.visualMrr + 0.05, lexicalPreserved: active.metrics.lexicalTop, negativeNotWorse: active.metrics.negativeCount <= shadow.metrics.negativeCount, latencyAcceptable: active.metrics.latencyP95Ms <= Math.max(shadow.metrics.latencyP95Ms * 1.8, shadow.metrics.latencyP95Ms + 1500) };
  const recommendation = Object.values(gates).every(Boolean) ? 'promote_active' : 'keep_shadow';
  const report = { status: 'pass', recommendation, gates, shadow: shadow.metrics, active: active.metrics, delta: { visualMrr: active.metrics.visualMrr - shadow.metrics.visualMrr, recallAt3: active.metrics.recallAt3 - shadow.metrics.recallAt3, latencyP95Ms: active.metrics.latencyP95Ms - shadow.metrics.latencyP95Ms }, pricing: shadow.pricing };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`PASS comparison: ${recommendation}`);
}

async function cleanup(db, statePath, reportPath) {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  let count = 0;
  for (const probe of [...(state.probes ?? []), ...(state.jpegSmoke ? [state.jpegSmoke] : [])]) {
    const result = await db.functions.invoke('delete-document', { body: { documentId: probe.documentId } });
    if (result.error) throw new Error(`Cleanup ${probe.id} failed: ${result.error.message}`);
    count += 1;
  }
  const notebook = await db.from('notebooks').delete().eq('id', state.notebookId);
  if (notebook.error) throw new Error(`Notebook cleanup failed: ${notebook.error.message}`);
  await writeFile(reportPath, JSON.stringify({ status: 'pass', documentsDeleted: count, notebookDeleted: true }, null, 2));
  console.log(`PASS cleanup ${count} documents`);
}

async function main() {
  const phase = env('VISUAL_BENCHMARK_PHASE');
  if (phase === 'compare') return compare(env('VISUAL_SHADOW_REPORT_PATH'), env('VISUAL_ACTIVE_REPORT_PATH'), env('VISUAL_COMPARISON_REPORT_PATH'));
  const db = client(); let loggedIn = false;
  try {
    const user = await login(db); loggedIn = true;
    if (phase === 'setup-shadow') await setup(db, user, env('VISUAL_BENCHMARK_STATE_PATH'), env('VISUAL_SHADOW_REPORT_PATH'));
    else if (phase === 'measure-active') await measure(db, env('VISUAL_BENCHMARK_STATE_PATH'), env('VISUAL_ACTIVE_REPORT_PATH'));
    else if (phase === 'cleanup') await cleanup(db, env('VISUAL_BENCHMARK_STATE_PATH'), env('VISUAL_CLEANUP_REPORT_PATH'));
    else throw new Error(`Unknown phase ${phase}`);
  } finally {
    if (loggedIn) await db.auth.signOut().catch(() => undefined);
  }
}
main().catch((error) => { console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
