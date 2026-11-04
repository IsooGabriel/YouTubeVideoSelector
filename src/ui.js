import { parseQuery, searchAll } from './search.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link=(url,text)=>url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`:esc(text);
function videoId(url){try{const u=new URL(url);if(u.hostname==='youtu.be')return u.pathname.slice(1);if(u.hostname.endsWith('youtube.com'))return u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|embed)\/([^/?]+)/)?.[1]||null;}catch{}return null;}

export function isTypingTarget(event){
  const t=event?.target;
  if(!t)return false;
  const tag=t.tagName?.toLowerCase();
  return tag==='input'||tag==='textarea'||tag==='select'||Boolean(t.isContentEditable);
}

const FILE_BADGE={'likely.jsonl':'likely','possible.jsonl':'possible','unknown.jsonl':'unknown','excluded.jsonl':'excluded'};
const PAGE_SIZE=50;
const DEBOUNCE_MS=250;

// ---- 検索パネルの部分更新 ----
// render() が全体を作り直すため、検索結果リストは DOM が存在する場合に限り in-place 更新する。
// render() 後は #search-results が新しく生成されるので、その後もイベント配線で正しく動作する。

let _searchRenderState=null; // { data, search, labels, file, index }
let _searchResultsEl=null;   // #search-results の DOM 参照
let _searchShown=0;          // 現在表示している件数

function buildResultItem(hit, currentFile, currentIndex, labels, actions) {
  const { file, index, record } = hit;
  const isCurrent = file === currentFile && index === currentIndex;
  const li = document.createElement('li');
  li.className = 'search-result-item' + (isCurrent ? ' current-result' : '');
  li.setAttribute('role', 'button');
  li.tabIndex = 0;

  // バッジ
  const badge = document.createElement('span');
  badge.className = 'result-badge result-badge--' + (FILE_BADGE[file] || 'unknown');
  badge.textContent = FILE_BADGE[file] || file;
  li.appendChild(badge);

  // タイトル (textContent で XSS防止)
  const titleText = record.title_raw || record.title || '（タイトルなし）';
  const titleEl = document.createElement('span');
  titleEl.className = 'result-title';
  titleEl.textContent = titleText;
  li.appendChild(titleEl);

  // チャンネル名
  const channelText = record.channel || '';
  if (channelText) {
    const chEl = document.createElement('span');
    chEl.className = 'result-channel';
    chEl.textContent = channelText;

    // チャンネル判定があれば表示
    const chLabel = record.channel_url && labels[record.channel_url];
    if (chLabel) {
      const lb = document.createElement('span');
      lb.className = 'result-channel-label';
      lb.textContent = chLabel.music_only ? '楽曲専用' : '非専用';
      chEl.appendChild(lb);
    }
    li.appendChild(chEl);
  }

  // 動画ID と 件数
  const meta = document.createElement('span');
  meta.className = 'result-meta';
  const vid = record.video_id || '';
  meta.textContent = (vid ? vid + ' · ' : '') + file + ' ' + (index + 1) + '件目';
  li.appendChild(meta);

  const onClick = () => actions.openResult(file, index);
  li.addEventListener('click', onClick);
  li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } });

  return li;
}

function renderSearchResults(container, state, actions, allResults) {
  if (!container) return;
  container.innerHTML = '';

  if (allResults === null) return; // 未検索状態

  // ヘッダー
  const header = document.createElement('div');
  header.className = 'search-result-header';
  if (allResults.length === 0) {
    header.textContent = '該当なし';
  } else {
    header.textContent = `全 ${allResults.length} 件ヒット`;
  }
  container.appendChild(header);

  if (allResults.length === 0) return;

  const shown = Math.min(_searchShown, allResults.length);
  const slice = allResults.slice(0, shown);

  const ul = document.createElement('ul');
  ul.className = 'search-result-list';
  for (const hit of slice) {
    ul.appendChild(buildResultItem(hit, state.file, state.index, state.labels, actions));
  }
  container.appendChild(ul);

  if (shown < allResults.length) {
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'search-more-btn';
    moreBtn.textContent = `さらに表示（残り ${allResults.length - shown} 件）`;
    moreBtn.addEventListener('click', () => {
      _searchShown = Math.min(_searchShown + PAGE_SIZE, allResults.length);
      renderSearchResults(container, state, actions, allResults);
    });
    container.appendChild(moreBtn);
  }
}

/** 検索を実行して結果コンテナを更新する（パネルが表示中かつクエリがある場合のみ）。 */
function executeSearch(state, actions) {
  const container = document.querySelector('#search-results');
  if (!container) return;
  const { query, fields, scope } = state.search;
  if (!query.trim()) {
    container.innerHTML = '';
    return;
  }
  const noFieldSelected = !fields.videoId && !fields.title && !fields.channel;
  if (noFieldSelected) {
    container.innerHTML = '<p class="search-warn">検索対象を1つ以上選択してください</p>';
    return;
  }
  const parsed = parseQuery(query);
  if (parsed.keywords.length === 0 && parsed.videoId === null) {
    container.innerHTML = '';
    return;
  }
  const FILE_ORDER = ['likely.jsonl', 'possible.jsonl', 'unknown.jsonl', 'excluded.jsonl'];
  const allResults = searchAll(state.data, parsed, { fields, scope, currentFile: state.file, fileOrder: FILE_ORDER, orders: state.view?.order });
  renderSearchResults(container, state, actions, allResults);
}

export function render(root, state, actions) {
  // 検索パネルのタブ状態を保持する（re-render をまたいで維持）
  const prevTab = root.querySelector('.nav-tab.active')?.dataset?.tab || 'jump';
  const prevSearchQuery = root.querySelector('#search-input')?.value ?? state.search.query;
  const prevSearchFocused = document.activeElement?.id === 'search-input';

  const r=state.current,
        id=videoId(r?.url),
        label=r?.channel_url&&state.labels[r.channel_url],
        counts=Object.entries(state.data).map(([n,x])=>`${n}: ${x.records.length}`).join(' / '),
        sourceFiles=state.sourceFiles||Object.keys(state.data);
  const total=state.viewLength??state.data[state.file]?.records?.length??0;
  const isTerminal=state.ready&&(!r||state.index>=total);
  const isNavDisabled=!state.ready||total===0||state.busy||isTerminal;
  const isJumpTab = prevTab !== 'search';

  root.innerHTML=`<main>${state.syncing?'<div class="syncing-bar" role="status" aria-live="polite">⟳ バックグラウンドで保存中…</div>':''}<header><h1>楽曲分類</h1><button id="choose">データフォルダを選択</button><select id="file" ${!state.ready?'disabled':''}>${sourceFiles.map(n=>`<option ${n===state.file?'selected':''}>${n}</option>`).join('')}</select><p class="status ${state.error?'error':''}">${esc(state.error||state.status||'フォルダを選択してください')}</p>${state.ready?`<small>${esc(state.file)} — ${total?state.index+1:0}/${total}　${esc(counts)}　分類済み: ${state.session}</small>`:''}</header><nav class="nav-panel" aria-label="ナビゲーション"><div class="nav-header"><div class="nav-tabs"><button class="nav-tab ${isJumpTab?'active':''}" data-tab="jump" type="button">ジャンプ</button><button class="nav-tab ${!isJumpTab?'active':''}" data-tab="search" type="button">検索</button></div><span class="jump-position"><strong>${total?state.index+1:0}</strong> / ${total} 件</span></div><div class="nav-tab-content ${isJumpTab?'':'hidden'}" data-content="jump"><div class="jump-controls"><div class="jump-input-group"><input type="number" id="jump-input" inputmode="numeric" min="1" max="${total}" placeholder="件数" ${isNavDisabled?'disabled':''}><button id="jump-go" type="button" ${isNavDisabled?'disabled':''}>移動</button></div><div class="jump-shortcuts"><button type="button" data-jump="first" ${isNavDisabled?'disabled':''}>先頭</button><button type="button" data-jump="-10" ${isNavDisabled?'disabled':''}>-10</button><button type="button" data-jump="+10" ${isNavDisabled?'disabled':''}>+10</button><button type="button" data-jump="last" ${isNavDisabled?'disabled':''}>末尾</button></div></div></div><div class="nav-tab-content ${!isJumpTab?'':'hidden'}" data-content="search"><div class="search-controls"><input type="search" id="search-input" placeholder="タイトル・チャンネル名・動画ID・URL" value="${esc(prevSearchQuery)}" autocomplete="off" ${!state.ready?'disabled':''}><div class="search-checkboxes"><label class="search-check"><input type="checkbox" id="ck-videoid" ${state.search.fields.videoId?'checked':''} ${!state.ready?'disabled':''}>動画ID</label><label class="search-check"><input type="checkbox" id="ck-title" ${state.search.fields.title?'checked':''} ${!state.ready?'disabled':''}>タイトル</label><label class="search-check"><input type="checkbox" id="ck-channel" ${state.search.fields.channel?'checked':''} ${!state.ready?'disabled':''}>チャンネル名</label></div><div class="search-scope"><label class="search-scope-label"><input type="radio" name="search-scope" value="all" ${state.search.scope==='all'?'checked':''} ${!state.ready?'disabled':''}>全ファイル</label><label class="search-scope-label"><input type="radio" name="search-scope" value="current" ${state.search.scope==='current'?'checked':''} ${!state.ready?'disabled':''}>現在のファイル</label></div></div><div id="search-results"></div></div></nav>${r?`<article><div class="eyebrow">${esc(state.file)} ${label?`・チャンネル判定: ${label.music_only?'楽曲専用':'楽曲専用ではない'}`:''}</div><h2>${link(r.url,r.title_raw||r.title||r.reason||'（タイトルなし）')}</h2><p class="channel">${link(r.channel_url,r.channel||'（チャンネル不明）')}</p>${id?(state.embed?`<div class="player"><iframe src="https://www.youtube-nocookie.com/embed/${esc(id)}" title="YouTube動画" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe><button id="embed">埋め込み表示を閉じる</button></div>`:'<button id="embed">動画を埋め込み表示</button>'):''}<dl>${r.play_count!=null?`<dt>再生回数</dt><dd>${esc(r.play_count)}</dd>`:''}${r.time?`<dt>日時</dt><dd>${esc(r.time)}</dd>`:''}${r.first_played?`<dt>初回再生</dt><dd>${esc(r.first_played)}</dd>`:''}${r.last_played?`<dt>最終再生</dt><dd>${esc(r.last_played)}</dd>`:''}</dl>${r.signals?.length?`<p><b>シグナル</b> ${r.signals.map(esc).join(' / ')}</p>`:''}<section class="channel-controls"><b>チャンネル判定</b><button data-label="true">楽曲専用</button><button data-label="false">楽曲専用ではない</button><button data-label="clear">判定を解除</button></section></article>`:state.ready?'<article class="empty"><h2>このファイルは完了です</h2></article>':''}<footer><button id="undo" ${state.busy?'disabled':''}>Undo</button><button id="backup" ${!state.ready||state.busy||state.syncing?'disabled':''}>バックアップZIP</button>${r?`<div class="actions">${[['likely.jsonl','楽曲の可能性が高い'],['possible.jsonl','楽曲の可能性あり'],['unknown.jsonl','判断保留'],['excluded.jsonl','対象外']].map(([n,t])=>`<button data-move="${n}">${t}<small>${n}${n===state.file?'（このまま次へ）':''}</small></button>`).join('')}</div>`:''}</footer></main>`;

  // ソートはナビゲーションと独立したコンパクトな操作列として追加する。
  const sortBar=document.createElement('div');
  sortBar.className='sort-bar';
  const sortOptions=(state.sort?.presets||[]).map(p=>`<option value="${esc(p.id)}" ${state.sort.currentId===p.id?'selected':''}>${esc(p.label)}</option>`).join('');
  sortBar.innerHTML=`<label>並び順: <select id="sort-select" ${!state.ready||state.busy?'disabled':''}>${sortOptions}${state.sort?.currentId?'':'<option value="custom" selected>カスタム</option>'}</select></label><button id="sort-reverse" type="button" title="並び順を反転" ${!state.ready||state.busy?'disabled':''}>⇅</button>`;
  root.querySelector('.nav-panel')?.before(sortBar);

  // ---- 基本イベント配線 ----
  root.querySelector('#choose')?.addEventListener('click',actions.choose);
  root.querySelector('#file')?.addEventListener('change',e=>actions.file(e.target.value));
  root.querySelector('#undo')?.addEventListener('click',actions.undo);
  root.querySelector('#backup')?.addEventListener('click',actions.backup);
  root.querySelector('#embed')?.addEventListener('click',actions.embed);
  root.querySelector('#sort-select')?.addEventListener('change',event=>{if(event.target.value!=='custom')actions.setSort(event.target.value);});
  root.querySelector('#sort-reverse')?.addEventListener('click',actions.reverseSort);
  root.querySelectorAll('[data-move]').forEach(b=>b.addEventListener('click',()=>actions.move(b.dataset.move)));
  root.querySelectorAll('[data-label]').forEach(b=>b.addEventListener('click',()=>actions.label(b.dataset.label)));

  // ---- ジャンプタブ ----
  const jumpInput=root.querySelector('#jump-input');
  const jumpGo=root.querySelector('#jump-go');
  const executeJump=()=>{
    if(!jumpInput||jumpInput.disabled)return;
    const val=jumpInput.value.trim();
    const num=val===''?NaN:Number(val);
    actions.jump(num);
  };
  jumpGo?.addEventListener('click',executeJump);
  jumpInput?.addEventListener('keydown',e=>{
    if(e.key==='Enter'){
      e.preventDefault();
      executeJump();
    }
  });
  root.querySelectorAll('[data-jump]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(btn.disabled)return;
      const act=btn.dataset.jump;
      if(act==='first')actions.goToIndex(0);
      else if(act==='last')actions.goToIndex(total-1);
      else if(act==='-10')actions.stepIndex(-10);
      else if(act==='+10')actions.stepIndex(+10);
    });
  });

  // ---- タブ切り替え ----
  root.querySelectorAll('.nav-tab').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const tab=btn.dataset.tab;
      root.querySelectorAll('.nav-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
      root.querySelectorAll('.nav-tab-content').forEach(el=>el.classList.toggle('hidden',el.dataset.content!==tab));
      if(tab==='search'){
        const si=root.querySelector('#search-input');
        si?.focus();
        // 検索タブを開いたときにクエリがあれば即時検索
        if(state.search.query.trim()){
          _searchShown=PAGE_SIZE;
          executeSearch(state,actions);
        }
      }
    });
  });

  // ---- 検索パネル ----
  const searchInput=root.querySelector('#search-input');
  const searchResultsEl=root.querySelector('#search-results');
  _searchResultsEl=searchResultsEl;

  // 検索パネルが表示されていてクエリがある場合、render後に結果を再導出して更新
  if(!isJumpTab && state.search.query.trim()){
    _searchShown=_searchShown||PAGE_SIZE;
    // 即時実行（render後なので DOM は存在する）
    executeSearch(state,actions);
  }
  if(prevSearchFocused && searchInput) searchInput.focus();

  // デバウンスタイマー
  let debounceTimer=null;
  let isComposing=false;

  const doSearch=()=>{
    if(!searchInput)return;
    const q=searchInput.value;
    // state.search.query を直接更新（setSearch は render を呼ぶので使わない）
    state.search.query=q;
    _searchShown=PAGE_SIZE;
    executeSearch(state,actions);
  };

  searchInput?.addEventListener('compositionstart',()=>{ isComposing=true; });
  searchInput?.addEventListener('compositionend',()=>{ isComposing=false; clearTimeout(debounceTimer); doSearch(); });
  searchInput?.addEventListener('input',()=>{
    if(isComposing)return;
    clearTimeout(debounceTimer);
    debounceTimer=setTimeout(doSearch,DEBOUNCE_MS);
  });
  searchInput?.addEventListener('keydown',e=>{
    if(e.key==='Enter'){ e.preventDefault(); clearTimeout(debounceTimer); doSearch(); }
  });

  // チェックボックス
  ['#ck-videoid','#ck-title','#ck-channel'].forEach(sel=>{
    root.querySelector(sel)?.addEventListener('change',()=>{
      const fields={
        videoId:root.querySelector('#ck-videoid')?.checked??false,
        title:root.querySelector('#ck-title')?.checked??true,
        channel:root.querySelector('#ck-channel')?.checked??true,
      };
      state.search.fields=fields;
      _searchShown=PAGE_SIZE;
      executeSearch(state,actions);
    });
  });

  // 検索範囲ラジオ
  root.querySelectorAll('[name="search-scope"]').forEach(radio=>{
    radio.addEventListener('change',()=>{
      state.search.scope=radio.value;
      _searchShown=PAGE_SIZE;
      executeSearch(state,actions);
    });
  });
}
