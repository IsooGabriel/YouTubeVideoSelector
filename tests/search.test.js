import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseJsonl } from '../src/jsonl-store.js';
import { normalize, extractVideoId, parseQuery, matchRecord, searchAll } from '../src/search.js';

test('normalize: NFKC正規化・小文字化・ひらがなカタカナ統一・null安全', () => {
  assert.equal(normalize(null), '');
  assert.equal(normalize(undefined), '');
  assert.equal(normalize(''), '');
  // 全角英数 -> 半角小文字
  assert.equal(normalize('ＡＢＣ１２３'), 'abc123');
  // カタカナ -> ひらがな統一
  assert.equal(normalize('アイミョン'), 'あいみょん');
  // 混在
  assert.equal(normalize('ＨＥＬＬＯ ワールド'), 'hello わーるど');
});

test('extractVideoId: watch?v=, youtu.be, shorts, embed から抽出できる', () => {
  assert.equal(extractVideoId('https://www.youtube.com/watch?v=_kTZrIdilRY'), '_kTZrIdilRY');
  assert.equal(extractVideoId('https://youtu.be/_kTZrIdilRY'), '_kTZrIdilRY');
  assert.equal(extractVideoId('https://www.youtube.com/shorts/_kTZrIdilRY'), '_kTZrIdilRY');
  assert.equal(extractVideoId('https://www.youtube.com/embed/_kTZrIdilRY'), '_kTZrIdilRY');
  // プロトコル省略形式
  assert.equal(extractVideoId('youtu.be/_kTZrIdilRY'), '_kTZrIdilRY');
  assert.equal(extractVideoId('www.youtube.com/watch?v=_kTZrIdilRY'), '_kTZrIdilRY');
  assert.equal(extractVideoId('invalid-url'), null);
  assert.equal(extractVideoId(''), null);
  assert.equal(extractVideoId(null), null);
});

test('parseQuery: URL貼り付けとキーワード分割（半角・全角空白）', () => {
  // 空文字・空白のみ
  assert.deepEqual(parseQuery(''), { keywords: [], videoId: null });
  assert.deepEqual(parseQuery('   '), { keywords: [], videoId: null });

  // YouTube URL (https付き & プロトコル省略)
  assert.deepEqual(parseQuery('https://www.youtube.com/watch?v=abc123XYZ00'), { keywords: [], videoId: 'abc123XYZ00' });
  assert.deepEqual(parseQuery('https://youtu.be/abc123XYZ00?t=10'), { keywords: [], videoId: 'abc123XYZ00' });
  assert.deepEqual(parseQuery('youtu.be/abc123XYZ00'), { keywords: [], videoId: 'abc123XYZ00' });
  assert.deepEqual(parseQuery('www.youtube.com/watch?v=abc123XYZ00'), { keywords: [], videoId: 'abc123XYZ00' });

  // 複数キーワード（半角・全角空白混在）
  assert.deepEqual(parseQuery('崩壊3rd　公式 MV'), { keywords: ['崩壊3rd', '公式', 'MV'], videoId: null });
});

test('matchRecord: 日本語・英大小・カタカナひらがな・動画ID大文字小文字の区別', () => {
  const rec1 = {
    video_id: 'aBcDeFgHiJk',
    url: 'https://www.youtube.com/watch?v=aBcDeFgHiJk',
    title_raw: 'アイミョン - マリーゴールド (Official Music Video)',
    channel: 'あいみょん Official'
  };

  const fieldsAll = { videoId: true, title: true, channel: true };

  // 1. タイトルのカタカナ/ひらがな・英大小
  assert.equal(matchRecord(rec1, parseQuery('あいみょん'), fieldsAll), true);
  assert.equal(matchRecord(rec1, parseQuery('マリーゴールド'), fieldsAll), true);
  assert.equal(matchRecord(rec1, parseQuery('まりーごーるど'), fieldsAll), true);
  assert.equal(matchRecord(rec1, parseQuery('OFFICIAL MUSIC VIDEO'), fieldsAll), true);
  assert.equal(matchRecord(rec1, parseQuery('official music video'), fieldsAll), true);

  // 2. 複数キーワード AND
  assert.equal(matchRecord(rec1, parseQuery('あいみょん マリーゴールド'), fieldsAll), true);
  assert.equal(matchRecord(rec1, parseQuery('あいみょん レモン'), fieldsAll), false);

  // 3. 動画IDは大文字小文字を区別する (case-sensitive)
  assert.equal(matchRecord(rec1, parseQuery('aBcDeFgHiJk'), { videoId: true, title: false, channel: false }), true);
  assert.equal(matchRecord(rec1, parseQuery('abcdefghijk'), { videoId: true, title: false, channel: false }), false);

  // 4. URL貼り付けは動画ID完全一致 (fieldsに関わらず一致)
  assert.equal(matchRecord(rec1, parseQuery('https://youtu.be/aBcDeFgHiJk'), { videoId: false, title: false, channel: false }), true);
  assert.equal(matchRecord(rec1, parseQuery('https://youtu.be/xxxxxxxxxxx'), fieldsAll), false);
});

test('matchRecord: チェックボックスの組み合わせ判定', () => {
  const rec = {
    video_id: 'vid12345678',
    title_raw: '夜に駆ける',
    channel: 'YOASOBI'
  };

  // タイトルのみチェック
  assert.equal(matchRecord(rec, parseQuery('夜に駆ける'), { videoId: false, title: true, channel: false }), true);
  assert.equal(matchRecord(rec, parseQuery('YOASOBI'), { videoId: false, title: true, channel: false }), false);

  // チャンネルのみチェック
  assert.equal(matchRecord(rec, parseQuery('yoasobi'), { videoId: false, title: false, channel: true }), true);
  assert.equal(matchRecord(rec, parseQuery('夜に駆ける'), { videoId: false, title: false, channel: true }), false);

  // 動画IDのみチェック
  assert.equal(matchRecord(rec, parseQuery('vid123'), { videoId: true, title: false, channel: false }), true);
  assert.equal(matchRecord(rec, parseQuery('yoasobi'), { videoId: true, title: false, channel: false }), false);

  // チェックなし
  assert.equal(matchRecord(rec, parseQuery('夜に駆ける'), { videoId: false, title: false, channel: false }), false);
});

test('matchRecord: 欠損プロパティやnullレコードで例外が出ない', () => {
  const broken = { reason: 'not_watch_url', title: '異形データ', url: null };
  const fields = { videoId: true, title: true, channel: true };

  assert.equal(matchRecord(broken, parseQuery('異形'), fields), true);
  assert.equal(matchRecord(broken, parseQuery('存在しない'), fields), false);

  const emptyRec = {};
  assert.equal(matchRecord(emptyRec, parseQuery('test'), fields), false);
});

test('searchAll: 検索範囲(current/all)と並び順、総件数', () => {
  const data = {
    'likely.jsonl': { records: [{ video_id: '1', title_raw: 'Song A' }, { video_id: '2', title_raw: 'Song B' }] },
    'possible.jsonl': { records: [{ video_id: '3', title_raw: 'Song C' }] },
    'unknown.jsonl': { records: [{ video_id: '4', title_raw: 'Song A2' }] },
    'excluded.jsonl': { records: [] }
  };
  const fields = { videoId: false, title: true, channel: false };

  // scope = 'current' (possible.jsonl)
  const resCurrent = searchAll(data, parseQuery('Song'), {
    fields,
    scope: 'current',
    currentFile: 'possible.jsonl',
    fileOrder: ['likely.jsonl', 'possible.jsonl', 'unknown.jsonl', 'excluded.jsonl']
  });
  assert.equal(resCurrent.length, 1);
  assert.equal(resCurrent[0].file, 'possible.jsonl');
  assert.equal(resCurrent[0].index, 0);

  // scope = 'all' (currentFile = possible.jsonl が先頭に並ぶ)
  const resAll = searchAll(data, parseQuery('Song'), {
    fields,
    scope: 'all',
    currentFile: 'possible.jsonl',
    fileOrder: ['likely.jsonl', 'possible.jsonl', 'unknown.jsonl', 'excluded.jsonl']
  });
  assert.equal(resAll.length, 4);
  assert.equal(resAll[0].file, 'possible.jsonl'); // currentFile が先頭
  assert.equal(resAll[1].file, 'likely.jsonl');   // その後は fileOrder 順
  assert.equal(resAll[2].file, 'likely.jsonl');
  assert.equal(resAll[3].file, 'unknown.jsonl');
});

test('実データ統合: sample-data/excluded.jsonl を使った実レコード検索', () => {
  const content = fs.readFileSync('sample-data/excluded.jsonl', 'utf-8');
  const records = parseJsonl(content, 'excluded.jsonl');
  const data = {
    'likely.jsonl': { records: [] },
    'possible.jsonl': { records: [] },
    'unknown.jsonl': { records: [] },
    'excluded.jsonl': { records }
  };
  const fileOrder = ['likely.jsonl', 'possible.jsonl', 'unknown.jsonl', 'excluded.jsonl'];

  // 1. タイトル検索 (NFKC・小文字・部分一致)
  {
    const parsed = parseQuery('解離性同一性障害');
    const res = searchAll(data, parsed, { fields: { videoId: false, title: true, channel: false }, scope: 'all', currentFile: 'excluded.jsonl', fileOrder });
    assert.equal(res.length, 1);
    assert.equal(res[0].record.video_id, 'Mr0G6hLrsdw');
  }

  // 2. チャンネル検索
  {
    const parsed = parseQuery('issei');
    const res = searchAll(data, parsed, { fields: { videoId: false, title: false, channel: true }, scope: 'all', currentFile: 'excluded.jsonl', fileOrder });
    assert.equal(res.length, 1);
    assert.equal(res[0].record.video_id, 'unMPCAD-OjY');
  }

  // 3. 動画ID検索 (大文字小文字の区別)
  {
    const parsedExact = parseQuery('wU7wghajoaI');
    const resExact = searchAll(data, parsedExact, { fields: { videoId: true, title: false, channel: false }, scope: 'all', currentFile: 'excluded.jsonl', fileOrder });
    assert.equal(resExact.length, 1);
    assert.equal(resExact[0].record.video_id, 'wU7wghajoaI');

    // 小文字にすると大文字小文字が異なるためヒットしない
    const parsedLower = parseQuery('wu7wghajoai');
    const resLower = searchAll(data, parsedLower, { fields: { videoId: true, title: false, channel: false }, scope: 'all', currentFile: 'excluded.jsonl', fileOrder });
    assert.equal(resLower.length, 0);
  }

  // 4. YouTube URL 貼り付け
  {
    const parsedUrl = parseQuery('https://www.youtube.com/watch?v=Mr0G6hLrsdw');
    const resUrl = searchAll(data, parsedUrl, { fields: { videoId: false, title: false, channel: false }, scope: 'all', currentFile: 'excluded.jsonl', fileOrder });
    assert.equal(resUrl.length, 1);
    assert.equal(resUrl[0].record.video_id, 'Mr0G6hLrsdw');
  }

  // 5. 異形レコード (title_rawが無くtitleプロパティを持つレコード)
  {
    const parsedBroken = parseQuery('切ないw');
    const resBroken = searchAll(data, parsedBroken, { fields: { videoId: false, title: true, channel: false }, scope: 'all', currentFile: 'excluded.jsonl', fileOrder });
    assert.equal(resBroken.length, 1);
    assert.equal(resBroken[0].record.title, '切ないw を表示しました');
  }
});
