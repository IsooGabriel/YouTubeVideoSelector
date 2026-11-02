/**
 * search.js — 検索機能の純粋関数群
 * DOM・state・ファイルシステムへの依存なし。副作用なし。
 *
 * フィールド対応表（実コードで確定済み）:
 *   動画ID     : record.video_id (存在しない異形レコードあり。URLから抽出で補完)
 *   タイトル   : record.title_raw (主) / record.title (異形レコード用フォールバック)
 *   チャンネル名: record.channel
 *   チャンネルURL: record.channel_url
 */

/** NFKC正規化 + 小文字化 + カタカナ→ひらがな統一。非文字列は空文字扱い。 */
export function normalize(str) {
  if (str == null || typeof str !== 'string') return '';
  return str
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, m => String.fromCharCode(m.charCodeAt(0) - 0x60));
}

/**
 * YouTube URL から動画ID（11文字）を抽出。
 * 該当しなければ null。
 */
export function extractVideoId(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.slice(1).split('?')[0];
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }
    if (u.hostname.endsWith('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:shorts|embed|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch {
    // URL ではない
  }
  return null;
}

/**
 * 入力文字列をキーワード配列と動画IDに分解する。
 * @returns {{ keywords: string[], videoId: string|null }}
 */
export function parseQuery(input) {
  if (typeof input !== 'string') return { keywords: [], videoId: null };
  const trimmed = input.trim();
  if (!trimmed) return { keywords: [], videoId: null };

  // URL貼り付け検出（https?:// または youtu.be / youtube.com）
  const looksLikeUrl = /^https?:\/\//i.test(trimmed) || /^(?:www\.)?youtu\.?be/i.test(trimmed) || /^(?:www\.)?youtube\.com/i.test(trimmed);
  if (looksLikeUrl) {
    const vid = extractVideoId(trimmed);
    if (vid) return { keywords: [], videoId: vid };
  }

  // 全角・半角空白で分割
  const parts = trimmed.split(/[\s\u3000]+/).filter(Boolean);
  return { keywords: parts, videoId: null };
}

/**
 * レコードの正規化済み検索文字列をキャッシュする WeakMap。
 * キーはレコードオブジェクト自体なので、差し替え後に古いキャッシュを引かない。
 */
const normCache = new WeakMap();

function getNormalized(record) {
  if (normCache.has(record)) return normCache.get(record);
  const title = normalize((record.title_raw ?? record.title) || '');
  const channel = normalize(record.channel || '');
  const entry = { title, channel };
  normCache.set(record, entry);
  return entry;
}

/**
 * レコードが検索条件にマッチするか判定。
 * @param {object} record
 * @param {{ keywords: string[], videoId: string|null }} parsed
 * @param {{ videoId: boolean, title: boolean, channel: boolean }} fields
 * @returns {boolean}
 */
export function matchRecord(record, parsed, fields) {
  const { keywords, videoId } = parsed;

  // URL貼り付けで動画IDが抽出できた場合: fieldsに関わらず動画ID完全一致で判定
  if (videoId !== null) {
    const recId = record.video_id || extractVideoId(record.url || '');
    return recId === videoId;
  }

  if (keywords.length === 0) return false;

  // 各キーワードについて「チェック済み項目のいずれかに含まれるか」(AND)
  const norm = getNormalized(record);
  const recVideoId = record.video_id || extractVideoId(record.url || '') || null;

  return keywords.every(kw => {
    // 動画IDフィールド: case-sensitive 部分一致
    if (fields.videoId && recVideoId && recVideoId.includes(kw)) return true;
    // タイトル: NFKC+小文字 部分一致
    if (fields.title && norm.title.includes(normalize(kw))) return true;
    // チャンネル名: NFKC+小文字 部分一致
    if (fields.channel && norm.channel.includes(normalize(kw))) return true;
    return false;
  });
}

/** ファイル表示順 */
const FILE_ORDER = ['likely.jsonl', 'possible.jsonl', 'unknown.jsonl', 'excluded.jsonl'];

/**
 * 全データから検索結果を導出する。
 * @param {Object} data - state.data ({ filename: { records: [] } })
 * @param {{ keywords: string[], videoId: string|null }} parsed
 * @param {{ fields: {videoId:bool, title:bool, channel:bool}, scope: 'current'|'all', currentFile: string, fileOrder: string[] }} opts
 * @returns {{ file: string, index: number, record: object }[]}
 */
export function searchAll(data, parsed, { fields, scope, currentFile, fileOrder }) {
  if (parsed.keywords.length === 0 && parsed.videoId === null) return [];

  const order = fileOrder || FILE_ORDER;
  // 現在のファイルを先頭、残りはfileOrder順
  const files = scope === 'current'
    ? [currentFile]
    : [currentFile, ...order.filter(f => f !== currentFile)];

  const results = [];
  for (const file of files) {
    const records = data[file]?.records;
    if (!records) continue;
    for (let i = 0; i < records.length; i++) {
      if (matchRecord(records[i], parsed, fields)) {
        results.push({ file, index: i, record: records[i] });
      }
    }
  }
  return results;
}
