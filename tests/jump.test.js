import test from 'node:test';
import assert from 'node:assert/strict';
import { isTypingTarget } from '../src/ui.js';

test('isTypingTarget: input, textarea, select, contenteditable を検知する', () => {
  assert.equal(isTypingTarget({ target: { tagName: 'INPUT' } }), true);
  assert.equal(isTypingTarget({ target: { tagName: 'input' } }), true);
  assert.equal(isTypingTarget({ target: { tagName: 'TEXTAREA' } }), true);
  assert.equal(isTypingTarget({ target: { tagName: 'SELECT' } }), true);
  assert.equal(isTypingTarget({ target: { tagName: 'DIV', isContentEditable: true } }), true);

  assert.equal(isTypingTarget({ target: { tagName: 'BUTTON' } }), false);
  assert.equal(isTypingTarget({ target: { tagName: 'DIV', isContentEditable: false } }), false);
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget({}), false);
});

test('goTo 境界チェックと状態遷移ロジックのシミュレーション', () => {
  // state と goTo の等価な純粋関数ロジックをテスト
  const createState = () => ({
    busy: false,
    ready: true,
    file: 'likely.jsonl',
    index: 0,
    embed: true,
    data: {
      'likely.jsonl': { records: [{ video_id: '1' }, { video_id: '2' }, { video_id: '3' }] },
      'empty.jsonl': { records: [] }
    },
    messageLog: []
  });

  const runGoTo = (state, fileName, index) => {
    if (state.busy) {
      state.messageLog.push({ error: '処理中のため移動できません' });
      return;
    }
    if (!state.ready) {
      state.messageLog.push({ error: 'データフォルダを選択してください' });
      return;
    }
    const list = state.data[fileName]?.records;
    if (!list || list.length === 0) {
      state.messageLog.push({ error: 'このファイルにはレコードがありません' });
      return;
    }
    if (!Number.isInteger(index) || index < 0 || index >= list.length) {
      state.messageLog.push({ error: `1〜${list.length} の範囲で指定してください` });
      return;
    }
    state.file = fileName;
    state.index = index;
    state.embed = false;
    state.messageLog.push({ status: `${index + 1} 件目に移動しました。` });
  };

  // 1. N=1 (index 0) への移動
  {
    const state = createState();
    runGoTo(state, 'likely.jsonl', 0);
    assert.equal(state.index, 0);
    assert.equal(state.embed, false);
    assert.equal(state.messageLog.at(-1)?.status, '1 件目に移動しました。');
  }

  // 2. N=3 (末尾 index 2) への移動
  {
    const state = createState();
    runGoTo(state, 'likely.jsonl', 2);
    assert.equal(state.index, 2);
    assert.equal(state.messageLog.at(-1)?.status, '3 件目に移動しました。');
  }

  // 3. 境界外 (N=0 -> index -1, N=4 -> index 3, 負数, 小数, NaN) で移動しない
  {
    const state = createState();
    const prevIndex = state.index;

    runGoTo(state, 'likely.jsonl', -1);
    assert.equal(state.index, prevIndex);
    assert.match(state.messageLog.at(-1)?.error, /1〜3 の範囲/);

    runGoTo(state, 'likely.jsonl', 3);
    assert.equal(state.index, prevIndex);
    assert.match(state.messageLog.at(-1)?.error, /1〜3 の範囲/);

    runGoTo(state, 'likely.jsonl', 1.5);
    assert.equal(state.index, prevIndex);
    assert.match(state.messageLog.at(-1)?.error, /1〜3 の範囲/);

    runGoTo(state, 'likely.jsonl', NaN);
    assert.equal(state.index, prevIndex);
    assert.match(state.messageLog.at(-1)?.error, /1〜3 の範囲/);
  }

  // 4. 空ファイルの場合
  {
    const state = createState();
    runGoTo(state, 'empty.jsonl', 0);
    assert.match(state.messageLog.at(-1)?.error, /レコードがありません/);
  }

  // 5. busy 中の場合
  {
    const state = createState();
    state.busy = true;
    runGoTo(state, 'likely.jsonl', 1);
    assert.equal(state.index, 0);
    assert.match(state.messageLog.at(-1)?.error, /処理中のため/);
  }
});
