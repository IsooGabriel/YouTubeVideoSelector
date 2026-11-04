import test from 'node:test';
import assert from 'node:assert/strict';
import {toSortText,parseSpecString,serializeSpec,reverseSpec,compareValues} from '../src/sort.js';
import {buildOrder,invertOrder} from '../src/view-order.js';

test('ソート文字列とspecは正規化・検証される',()=>{
  assert.equal(toSortText(' 【ＡＢＣ'), 'abc');
  assert.equal(toSortText(' 🎵 '), '🎵');
  assert.equal(toSortText(''),null);
  assert.deepEqual(parseSpecString('channel:asc,title:asc'),[{key:'channel',dir:'asc'},{key:'title',dir:'asc'}]);
  assert.equal(parseSpecString('unknown:asc'),null);
  assert.equal(parseSpecString('title:up'),null);
  assert.equal(serializeSpec([{key:'title',dir:'desc'}]),'title:desc');
  assert.deepEqual(reverseSpec([{key:'title',dir:'asc'}]),[{key:'title',dir:'desc'}]);
});
test('空値は方向に関係なく最後、同値は元順を維持する',()=>{
  assert.equal(compareValues(null,'a','desc'),1);
  const records=[{title_clean:'【B】',channel:'same',channel_url:'z'},{title_clean:'🎵 A',channel:'same',channel_url:'a'},{title_raw:'C',artist_guess:null},{title_clean:''}];
  const order=buildOrder(records,[{key:'channel',dir:'asc'},{key:'title',dir:'asc'}]);
  assert.deepEqual(order,[1,0,2,3]);
  assert.deepEqual(invertOrder(order),[1,0,2,3]);
  assert.deepEqual(buildOrder(records,[]),[0,1,2,3]);
});
