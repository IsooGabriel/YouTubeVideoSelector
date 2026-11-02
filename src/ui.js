const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link=(url,text)=>url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`:esc(text);
function videoId(url){try{const u=new URL(url);if(u.hostname==='youtu.be')return u.pathname.slice(1);if(u.hostname.endsWith('youtube.com'))return u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|embed)\/([^/?]+)/)?.[1]||null;}catch{}return null;}

export function isTypingTarget(event){
  const t=event?.target;
  if(!t)return false;
  const tag=t.tagName?.toLowerCase();
  return tag==='input'||tag==='textarea'||tag==='select'||Boolean(t.isContentEditable);
}

export function render(root,state,actions){
  const r=state.current,
        id=videoId(r?.url),
        label=r?.channel_url&&state.labels[r.channel_url],
        counts=Object.entries(state.data).map(([n,x])=>`${n}: ${x.records.length}`).join(' / '),
        sourceFiles=state.sourceFiles||Object.keys(state.data);
  const currentRecords=state.data[state.file]?.records||[];
  const total=currentRecords.length;
  const isTerminal=state.ready&&(!r||state.index>=total);
  const isNavDisabled=!state.ready||total===0||state.busy||isTerminal;

  root.innerHTML=`<main>${state.syncing?'<div class="syncing-bar" role="status" aria-live="polite">⟳ バックグラウンドで保存中…</div>':''}<header><h1>楽曲分類</h1><button id="choose">データフォルダを選択</button><select id="file" ${!state.ready?'disabled':''}>${sourceFiles.map(n=>`<option ${n===state.file?'selected':''}>${n}</option>`).join('')}</select><p class="status ${state.error?'error':''}">${esc(state.error||state.status||'フォルダを選択してください')}</p>${state.ready?`<small>${esc(state.file)} — ${total?state.index+1:0}/${total}　${esc(counts)}　分類済み: ${state.session}</small>`:''}</header><nav class="nav-panel" aria-label="ナビゲーション"><div class="nav-header"><div class="nav-tabs"><span class="nav-tab active">ジャンプ</span></div><span class="jump-position"><strong>${total?state.index+1:0}</strong> / ${total} 件</span></div><div class="jump-controls"><div class="jump-input-group"><input type="number" id="jump-input" inputmode="numeric" min="1" max="${total}" placeholder="件数" ${isNavDisabled?'disabled':''}><button id="jump-go" type="button" ${isNavDisabled?'disabled':''}>移動</button></div><div class="jump-shortcuts"><button type="button" data-jump="first" ${isNavDisabled?'disabled':''}>先頭</button><button type="button" data-jump="-10" ${isNavDisabled?'disabled':''}>-10</button><button type="button" data-jump="+10" ${isNavDisabled?'disabled':''}>+10</button><button type="button" data-jump="last" ${isNavDisabled?'disabled':''}>末尾</button></div></div></nav>${r?`<article><div class="eyebrow">${esc(state.file)} ${label?`・チャンネル判定: ${label.music_only?'楽曲専用':'楽曲専用ではない'}`:''}</div><h2>${link(r.url,r.title_raw||r.title||r.reason||'（タイトルなし）')}</h2><p class="channel">${link(r.channel_url,r.channel||'（チャンネル不明）')}</p>${id?(state.embed?`<div class="player"><iframe src="https://www.youtube-nocookie.com/embed/${esc(id)}" title="YouTube動画" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe><button id="embed">埋め込み表示を閉じる</button></div>`:'<button id="embed">動画を埋め込み表示</button>'):''}<dl>${r.play_count!=null?`<dt>再生回数</dt><dd>${esc(r.play_count)}</dd>`:''}${r.time?`<dt>日時</dt><dd>${esc(r.time)}</dd>`:''}${r.first_played?`<dt>初回再生</dt><dd>${esc(r.first_played)}</dd>`:''}${r.last_played?`<dt>最終再生</dt><dd>${esc(r.last_played)}</dd>`:''}</dl>${r.signals?.length?`<p><b>シグナル</b> ${r.signals.map(esc).join(' / ')}</p>`:''}<section class="channel-controls"><b>チャンネル判定</b><button data-label="true">楽曲専用</button><button data-label="false">楽曲専用ではない</button><button data-label="clear">判定を解除</button></section></article>`:state.ready?'<article class="empty"><h2>このファイルは完了です</h2></article>':''}<footer><button id="undo" ${state.busy?'disabled':''}>Undo</button><button id="backup" ${!state.ready||state.busy||state.syncing?'disabled':''}>バックアップZIP</button>${r?`<div class="actions">${[['likely.jsonl','楽曲の可能性が高い'],['possible.jsonl','楽曲の可能性あり'],['unknown.jsonl','判断保留'],['excluded.jsonl','対象外']].map(([n,t])=>`<button data-move="${n}">${t}<small>${n}${n===state.file?'（このまま次へ）':''}</small></button>`).join('')}</div>`:''}</footer></main>`;

  root.querySelector('#choose')?.addEventListener('click',actions.choose);
  root.querySelector('#file')?.addEventListener('change',e=>actions.file(e.target.value));
  root.querySelector('#undo')?.addEventListener('click',actions.undo);
  root.querySelector('#backup')?.addEventListener('click',actions.backup);
  root.querySelector('#embed')?.addEventListener('click',actions.embed);
  root.querySelectorAll('[data-move]').forEach(b=>b.addEventListener('click',()=>actions.move(b.dataset.move)));
  root.querySelectorAll('[data-label]').forEach(b=>b.addEventListener('click',()=>actions.label(b.dataset.label)));

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
}
