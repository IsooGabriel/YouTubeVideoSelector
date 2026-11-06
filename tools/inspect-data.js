#!/usr/bin/env node
// JSONL実データを読み取り専用で調査する。個人情報となる値は出力しない。
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const FILES = ['likely.jsonl', 'possible.jsonl', 'unknown.jsonl', 'excluded.jsonl'];
const directory = process.argv[2];

if (!directory) {
  console.error('使い方: node tools/inspect-data.js <実データをコピーしたフォルダ>');
  process.exitCode = 1;
} else {
  const seen = new Map();
  const summaries = [];
  for (const name of FILES) summaries.push(await inspectFile(directory, name, seen));
  console.log(JSON.stringify({ files: summaries, duplicateVideoIds: summarizeDuplicates(seen) }, null, 2));
}

async function inspectFile(directory, name, seen) {
  const path = join(directory, name);
  let text;
  let size;
  try {
    [text, { size }] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
  } catch (error) {
    return { file: name, error: error.code === 'ENOENT' ? 'missing' : 'unreadable' };
  }

  const summary = {
    file: name,
    bytes: size,
    bom: text.startsWith('\uFEFF'),
    lineEnding: detectLineEnding(text),
    trailingNewline: /(?:\r?\n)$/.test(text),
    lines: 0,
    records: 0,
    blankLines: 0,
    invalidLineNumbers: [],
    longestLineBytes: 0,
    fields: {},
    emptyFields: {},
    dateFormats: {},
    titleDifferences: 0
  };
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  summary.lines = lines.length;
  for (let offset = 0; offset < lines.length; offset += 1) {
    const line = lines[offset];
    summary.longestLineBytes = Math.max(summary.longestLineBytes, Buffer.byteLength(line));
    if (!line.trim()) {
      summary.blankLines += 1;
      continue;
    }
    let record;
    try {
      record = JSON.parse(line);
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('not-object');
    } catch {
      summary.invalidLineNumbers.push(offset + 1);
      continue;
    }
    summary.records += 1;
    for (const [key, value] of Object.entries(record)) {
      const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      summary.fields[key] ??= {};
      summary.fields[key][type] = (summary.fields[key][type] ?? 0) + 1;
      if (value === '' || value === null || (Array.isArray(value) && value.length === 0)) {
        summary.emptyFields[key] = (summary.emptyFields[key] ?? 0) + 1;
      }
    }
    for (const key of ['first_played', 'last_played']) {
      if (typeof record[key] === 'string') {
        const kind = classifyDate(record[key]);
        summary.dateFormats[`${key}:${kind}`] = (summary.dateFormats[`${key}:${kind}`] ?? 0) + 1;
      }
    }
    if (typeof record.title_clean === 'string' && typeof record.title_raw === 'string' && record.title_clean !== record.title_raw) summary.titleDifferences += 1;
    if (typeof record.video_id === 'string' && record.video_id) {
      const locations = seen.get(record.video_id) ?? [];
      locations.push({ file: name, line: offset + 1 });
      seen.set(record.video_id, locations);
    }
  }
  return summary;
}

function classifyDate(value) {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return 'iso-milliseconds';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return 'iso-seconds';
  return Number.isNaN(Date.parse(value)) ? 'invalid' : 'other-parseable';
}

function detectLineEnding(text) {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  if (crlf && lf) return 'mixed';
  if (crlf) return 'crlf';
  if (lf) return 'lf';
  return 'none';
}

function summarizeDuplicates(seen) {
  const duplicates = [];
  for (const locations of seen.values()) if (locations.length > 1) duplicates.push(locations);
  return { groups: duplicates.length, locations: duplicates };
}
