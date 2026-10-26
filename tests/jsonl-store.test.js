import test from 'node:test';
import assert from 'node:assert/strict';
import {parseJsonl,serializeJsonl,JsonlError,validateUnique,planMove} from '../src/jsonl-store.js';
const a={video_id:'a',title_raw:'タイトル',signals:['x'],plays:['2026-01-01'],artist_guess:null};
test('JSONL: 空行を無視し全プロパティを保持する',()=>{const records=parseJsonl(`\n${JSON.stringify(a)}\n\n`,'unknown.jsonl');assert.deepEqual(records,[a]);assert.deepEqual(parseJsonl(serializeJsonl(records)),[a]);});
test('欠損フィールドがあってもJSONオブジェクトを表示用に読み込む',()=>{assert.deepEqual(parseJsonl('{"title_raw":"タイトルだけ"}'),[{title_raw:'タイトルだけ'}]);});
test('JSONL: 破損行はファイル名と行番号を持つ',()=>{assert.throws(()=>parseJsonl('{bad}','likely.jsonl'),e=>e instanceof JsonlError&&e.file==='likely.jsonl'&&e.line===1);});
test('移動計画は元データを変えず、重複を拒否する',()=>{const p=planMove([a],[],a.video_id);assert.deepEqual(p.source,[]);assert.deepEqual(p.destination,[a]);assert.deepEqual(a.signals,['x']);assert.throws(()=>planMove([a],[a],'a'));});
test('複数ファイルにまたがるvideo_id重複を検出する',()=>{assert.deepEqual(validateUnique({a:[a],b:[a]}),[{video_id:'a',files:['a','b']}]);});
