# ソート機能 実装仕様書（AIエージェント向け）

対象プロジェクト: YouTube Video Selector（`PROJECT_FLOW.md` / `JUMP_FEATURE_SPEC.md` / `SEARCH_FEATURE_SPEC.md` 参照）
目的: 現在のファイルのレコードを、曲名順・視聴日順・チャンネル順（同一チャンネル内は曲名順）などの**表示順**で確認できるようにする。
追加要件: 本機能群は将来、機能ごとに分割して別の実サイトへ移行する。**依存関係が一方向で、domain 層が環境に依存しない設計**にすること（§3）。

---

## 0. エージェントへの前提指示（最初に必ず読むこと）

1. `PROJECT_FLOW.md` と実データのサンプル（`likely.jsonl`、661件）から作成した仕様であり、**`main.js` / `ui.js` などの実コードは未確認**である。`state.file` / `state.index` / `state.data` / `state.busy` / `applyMoveInMemory` / `goTo` / `actions` / `render` / `notify` などの名前は仮定である。
2. 実装前に `src/main.js` と `src/ui.js` を読み、次を確認すること。
   - `state.index` を参照・更新している**すべての箇所**（`grep` で洗い出す）
   - `applyMoveInMemory` がデータ配列をどう変更するか（in-place か、新配列に差し替えか。移動先のどこにレコードを追加するか）
   - Undo が履歴（IndexedDB）のどのフィールドから復元位置を決めているか
   - 終端状態（最後のレコードを処理した直後の `index >= length`）の現行の扱い
3. 仕様と実コードが食い違う場合は**実コードに合わせ**、差分を最終報告に書くこと。
4. ジャンプ機能（`goTo(fileName, index)`・入力中のショートカットガード）は実装済み、検索機能は仕様書が作成済み（未実装の可能性あり）という前提。状況を確認し、未実装なら §7 は「実装時の注意」として扱う。

### 0.1 実データで確認済みの事実（`likely.jsonl` 661件）

| 事実 | 設計への影響 |
| :--- | :--- |
| プロパティ: `video_id`, `url`, `title_raw`, `title_clean`, `channel`, `channel_url`, `signals`, `warnings`, `play_count`, `first_played`, `last_played`, `ad_plays`, `artist_guess`, `plays` | プロパティ名はこの名前を正とする（検索仕様書の仮名 `title` は `title_clean` / `title_raw` に読み替える） |
| `video_id` は661件すべて一意 | レコードの同一性キーとして `video_id` を使う |
| `first_played` / `last_played` は ISO 文字列だが、**7件はミリ秒なし**（`2018-07-26T02:29:56Z` と `2025-10-20T07:02:08.780Z` が混在） | 文字列比較は禁止。`Date.parse` で数値化して比較する |
| 5件は `title_raw` / `title_clean` / `channel` / `channel_url` がすべて空文字（`warnings: ["deleted_or_private"]`） | 空値は昇順・降順どちらでも**常に末尾**にする |
| `artist_guess` は225件が `null` | 同様に null は常に末尾 |
| 同名で別 `channel_url` のチャンネルがある（`Aiobahn` が2URL、`Release - Topic` が4URL） | チャンネル比較は「名前 → `channel_url`」の順にし、別チャンネルが混ざらないようにする |
| `title_clean` の先頭が `【` `[` `「` や絵文字のものが多い（約70件以上） | ソート用テキストでは先頭の記号・空白を除去する（§1.3） |
| `play_count` は 1〜11、`plays` は昇順、`last_played = max(plays)`、`first_played = min(plays)` | `plays` 配列は使わず `first_played` / `last_played` を使う |

---

## 1. 要件と仕様上の決定事項

### 1.1 ソートは「表示順」のみ（最重要）

- **JSONLファイルの並び・メモリ上のデータ配列の並びは、ソートによって一切変更しない。**
- ソートは「表示位置 → データ位置」の対応表 `order[]` を作ることで実現する。
- `writeQueue` / `history.js` / `file-system.js` / `jsonl-store.js` / `backup.js` は**変更しない**。ソート操作でファイル書き込みは発生しない。

### 1.2 `state.index` の意味の変更

- **`state.index` は「現在のソート順での表示位置（0始まり）」とする。**
- 現在のレコード = `state.data[file][ order[file][state.index] ]`
- ジャンプの「N件目」、検索結果の「N件目」、位置表示「12 / 340」はすべて**表示位置基準**にそろえる。
- ソート未設定（ファイル順）のときは `order` が恒等写像になり、従来と同じ挙動になる。

### 1.3 ソートキー

| キー | 表示名 | 値の取り出し元 | 型 | 備考 |
| :--- | :--- | :--- | :--- | :--- |
| `title` | 曲名 | `title_clean`（空なら `title_raw`） | text | `toSortText()` を通す |
| `channel` | チャンネル | `channel` | text | 同値の場合 `channel_url` で比較（§1.5） |
| `artist` | アーティスト | `artist_guess` | text | null は末尾 |
| `last_played` | 最終視聴日 | `last_played` | date | `Date.parse` で数値化 |
| `first_played` | 初回視聴日 | `first_played` | date | 同上 |
| `play_count` | 再生回数 | `play_count` | number | |

**テキスト比較の方針（決定済み）**: 読みは考慮せず、**Unicode順（文字列の `<` / `>` 比較）**とする。`Intl.Collator` は環境差（サイト移行後のサーバー側など）を避けるため**採用しない**。

```js
// toSortText: ソート用の正規化。この関数1つに集約すること（挙動を変えたいときはここだけ直す）
export function toSortText(s) {
  const t = String(s ?? '').normalize('NFKC').toLowerCase().trim();
  const stripped = t.replace(/^[\p{P}\p{S}\p{Z}\uFE0F\u200D]+/u, ''); // 先頭の記号・空白・絵文字を除去
  const out = stripped || t;   // 全部記号だった場合は元の文字列を使う
  return out === '' ? null : out; // 空は null（=末尾扱い）
}
```

- 漢字は読み順にならず、コードポイント順になる。**これは仕様上の制約として許容済み**。
- ひらがな/カタカナの統一は行わない（Unicode順のまま）。

### 1.4 比較ルール

1. ソート設定 `spec` は `[{ key, dir }]`（`dir` は `'asc'` | `'desc'`）。最大3段、同じキーの重複は不可。
2. 各段で値を比較し、差があればその時点で確定、同値なら次の段へ。
3. **null（空値）は `dir` に関係なく常に後ろ**。降順で先頭に来てはならない。
4. 全段で同値なら、**元のデータ位置の昇順**で決着させる（毎回同じ並びになる安定ソート）。
5. `spec` が空配列のときはソートなし（元の順序）。

### 1.5 チャンネルキーの内部比較

`channel` は「`toSortText(channel)` → 同値なら `channel_url`（素の文字列比較）」の順で比較する。方向（`dir`）は両方に適用する。`channel` が空のレコードは null として末尾。

### 1.6 プリセット（宣言データ）

| id | 表示名 | spec |
| :--- | :--- | :--- |
| `original` | ファイル順 | `[]` |
| `title_asc` | 曲名 A→Z | `[{title,asc}]` |
| `title_desc` | 曲名 Z→A | `[{title,desc}]` |
| `recent` | 最近視聴した順 | `[{last_played,desc}, {title,asc}]` |
| `oldest` | 最終視聴が古い順 | `[{last_played,asc}, {title,asc}]` |
| `first_played_asc` | 初回視聴が古い順 | `[{first_played,asc}, {title,asc}]` |
| `channel_title` | チャンネル → 曲名 | `[{channel,asc}, {title,asc}]` |
| `artist_title` | アーティスト → 曲名 | `[{artist,asc}, {title,asc}]` |
| `most_played` | 再生回数の多い順 | `[{play_count,desc}, {title,asc}]` |

プリセットの追加はこの表（データ）への追記だけで済むようにする。

### 1.7 ソート変更時の挙動

- 変更時は**現在表示中のレコードを選択したまま**新しい表示位置へ移す（`video_id` で位置を引き直す）。
- 現在のレコードが無い（終端状態・0件）場合は、`index` を 0 にする（0件なら 0 のまま）。
- 表示中のレコードが変わらない場合、**YouTube埋め込みを再読込しない**こと（`video_id` が同じなら埋め込み要素を再生成しない）。
- `state.busy` が true の間はソート変更を拒否する（`notify` で通知）。

### 1.8 昇降の反転

UIの「反転」ボタンは、`spec` の**全段の `dir` を反転**する。`spec` が空（ファイル順）のときは反転ボタンを無効化する。

### 1.9 設定の保存

- ソート設定は端末内に保存し、次回起動時に復元する（§5 Task 5）。
- 保存形式は文字列（例: `channel:asc,title:asc`。`original` は空文字）。
- 読み込み時に検証し、**未知のキー・不正な方向・4段以上・重複・壊れた値は破棄して `[]` に戻す**。
- ソート設定はJSONLファイル・`channel_labels.json` には**保存しない**。

---

## 2. 設計の全体像

### 2.1 レイヤーと依存ルール

```mermaid
graph TD
    subgraph UI
        UI[ui.js]
    end
    subgraph Application
        MAIN[main.js]
    end
    subgraph Domain[Domain 純粋関数のみ]
        RF[record-fields.js]
        SORT[sort.js]
        VO[view-order.js]
        SEARCH[search.js]
    end
    subgraph Infrastructure
        PREF[preferences.js]
        FS[file-system.js]
        HIST[history.js]
    end

    UI -->|actions / 表示用データ| MAIN
    MAIN --> SORT
    MAIN --> VO
    MAIN --> SEARCH
    MAIN --> PREF
    MAIN --> FS
    MAIN --> HIST
    SORT --> RF
    VO --> SORT
    SEARCH --> RF
```

| ルール | 内容 |
| :--- | :--- |
| R1 | **domain 層（`record-fields.js` / `sort.js` / `view-order.js` / `search.js`）は、DOM・`window`・`localStorage`・IndexedDB・`state` に依存しない。** import してよいのは domain 同士のみ |
| R2 | domain 層の関数は純粋関数にする（副作用なし。キャッシュ用の `WeakMap` のみ例外として許可） |
| R3 | **`ui.js` は domain 層を import しない。** 並び順の名前・選択肢・位置表示に必要なデータは `main.js` 経由で受け取る |
| R4 | infrastructure 層（`preferences.js` など）は domain 層を import しない（保存形式は文字列として受け渡す） |
| R5 | **レコードのプロパティ名を直接参照してよいのは `record-fields.js` のみ。** 他の domain モジュールはアクセサ関数を使う |
| R6 | 保存先（`preferences`）は `main.js` に**注入**し、`main.js` は具体的な保存先（`localStorage` など）を直接参照しない |

### 2.2 将来の移行方針（参考）

- domain 層はそのまま共有パッケージとして切り出せる（サーバー側のAPIでも同じ並び順ロジックを使える）。
- 実サイトでは `preferences.js` をユーザー設定API等に差し替え、`file-system.js` をデータ取得層に差し替える。
- ソート設定の文字列表現（`channel:asc,title:asc`）はそのままURLクエリ・APIパラメータに使える。

---

## 3. モジュール仕様

### 3.1 `src/record-fields.js`（新規・domain）

レコードのプロパティ名を知っている**唯一の場所**。欠損・null・型違いでも例外を出さない。

```js
export const getVideoId     = (r) => str(r?.video_id);
export const getTitle       = (r) => str(r?.title_clean) || str(r?.title_raw); // 曲名（title_clean 優先）
export const getTitleRaw    = (r) => str(r?.title_raw);
export const getChannel     = (r) => str(r?.channel);
export const getChannelUrl  = (r) => str(r?.channel_url);
export const getArtist      = (r) => str(r?.artist_guess) || null;             // null は null のまま
export const getPlayCount   = (r) => Number.isFinite(r?.play_count) ? r.play_count : null;
export const getLastPlayed  = (r) => parseTime(r?.last_played);                // ms (number) | null
export const getFirstPlayed = (r) => parseTime(r?.first_played);

function str(v) { return typeof v === 'string' ? v : ''; }
function parseTime(v) { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
```

### 3.2 `src/sort.js`（新規・domain）

```js
export const SORT_KEYS = {
  title:        { label: '曲名',         type: 'text',   getValue: (r) => toSortText(getTitle(r)) },
  channel:      { label: 'チャンネル',   type: 'text',   getValue: (r) => toSortText(getChannel(r)),
                  getTie: (r) => getChannelUrl(r) || null },
  artist:       { label: 'アーティスト', type: 'text',   getValue: (r) => toSortText(getArtist(r)) },
  last_played:  { label: '最終視聴日',   type: 'date',   getValue: getLastPlayed },
  first_played: { label: '初回視聴日',   type: 'date',   getValue: getFirstPlayed },
  play_count:   { label: '再生回数',     type: 'number', getValue: getPlayCount },
};

export const SORT_PRESETS = [ /* §1.6 の表を { id, label, spec } の配列で定義 */ ];

export function toSortText(s) { /* §1.3 */ }

export function normalizeSpec(spec)    // 検証して正規化した spec を返す。不正なら null
export function serializeSpec(spec)    // [{key:'channel',dir:'asc'},{key:'title',dir:'asc'}] → 'channel:asc,title:asc'
export function parseSpecString(str)   // 上の逆。不正なら null（呼び出し側が [] にフォールバック）
export function reverseSpec(spec)      // 全段の dir を反転
export function findPresetId(spec)     // spec に一致するプリセット id、なければ null（UI表示用）

export function getSortValues(record, spec)
// レコード × キーごとの値を取得し、WeakMap<record, Map<keyName, value>> にキャッシュ。
// レコードは本アプリ内で不変として扱う。もしレコードをその場で書き換える処理があれば報告すること。

export function compareValues(va, vb, dir)
// 両方 null → 0、片方 null → null側が後ろ（dir に関係なく）、それ以外は va<vb ? -1 : va>vb ? 1 : 0 を dir で反転
```

### 3.3 `src/view-order.js`（新規・domain）

```js
export function buildOrder(records, spec)
// 戻り値: number[]  order[表示位置] = データ位置
// - spec が空なら恒等写像 [0..n-1]
// - 各レコードの比較値を事前に取得（getSortValues）→ 添字配列をソート
// - 比較は §1.4。最後に必ず「データ位置の昇順」で決着
// - 入力 records は変更しない

export function invertOrder(order)
// 戻り値: number[]  inverse[データ位置] = 表示位置
```

### 3.4 `src/preferences.js`（新規・infrastructure）

```js
export function createPreferences(storage = window.localStorage) {
  return {
    loadSortSpec()    { /* 文字列 | null。storage が使えない・読めない場合も null（try/catch） */ },
    saveSortSpec(str) { /* try/catch。失敗しても例外を投げない */ },
  };
}
```

- キー名: `music-selector:sort-spec`（値の先頭にバージョン `v1;` を付けて将来の形式変更に備える）
- domain を import しない。文字列の受け渡しだけを行う（R4）。

---

## 4. 実装タスク

### Task 1: `record-fields.js` / `sort.js` / `view-order.js` と単体テスト

- §3 の仕様どおりに実装する。
- テストを `test/` 配下に追加する（Node 標準の `node:test` / `node:assert` のみ。**外部依存を追加しない**）。実行方法を最終報告に書く。
- テストデータは**合成フィクスチャ**（少数レコード）とし、§0.1 の特徴（ミリ秒なし日付、空レコード、`artist_guess: null`、同名別URLチャンネル、`【` 始まり・絵文字始まりのタイトル）を必ず含める。実データ（`likely.jsonl`）はリポジトリに含めない。

### Task 2: `main.js` — 状態と表示順の管理

```js
state.view = {
  spec: [],        // 現在のソート設定
  order:   {},     // { [fileName]: number[] }  表示位置 → データ位置
  inverse: {},     // { [fileName]: number[] }  データ位置 → 表示位置
};
```

追加・変更する関数（名前は実コードに合わせる）:

- `rebuildView(...fileNames)`: 指定ファイルの `order` / `inverse` を `buildOrder` / `invertOrder` で再構築する。
- `viewLength(file)` / `getRecordAt(file, viewIndex)`: 表示位置からレコードを取得する（`state.data[file][ order[file][viewIndex] ]`）。
- `getCurrentRecord()`: 現在のレコード（無ければ null）。
- `locateByVideoId(videoId)`: 全ファイルを検索し `{ file, viewIndex, dataIndex }` または null を返す。
- `setSort(spec)`: §1.7 に従う。流れは `busy 拒否 → normalizeSpec → 現在レコード保持 → state.view.spec 更新 → 全ファイル rebuildView → 位置の引き直し → preferences 保存 → render`。
- `actions.setSort(presetIdOrSpec)` / `actions.reverseSort()` を公開する。

**`rebuildView` を呼ぶタイミング（漏れがないよう集約すること）**:

1. 起動時、全ファイルの読込完了直後（保存済みの設定を `parseSpecString` → `normalizeSpec` で復元してから）
2. `applyMoveInMemory` の完了直後（移動元・移動先の2ファイル）
3. Undo によるメモリ変更の完了直後
4. `setSort` 時（全ファイル）

**`state.index` を使っている既存コードの修正（Task 2 の最重要部分）**:

- 現行コードが `state.index` を**データ配列の添字として直接使っている箇所**を、すべて `order` 経由に置き換える。
- `applyMoveInMemory(src, dst, record)`: 移動元から削除する位置は `order[src][state.index]`（またはレコード参照・`video_id` での検索）で求める。`state.index` をそのままデータ添字にしてはならない。
- 分類後の `state.index`: **変更しない**（移動元の再構築後、同じ表示位置に次のレコードが来る）。終端状態（`index >= length`）の扱いは現行どおり維持する。
- 同一ファイル移動のスキップ（`index + 1`）: 表示順での次のレコードになる。挙動は維持。
- **Undo**: 履歴に保存された位置情報（index 等）は使わない。メモリへ復元した後、復元レコードを `video_id` で `locateByVideoId`（または移動元ファイル内検索）し、`state.file = source`、`state.index = その viewIndex` とする。履歴に旧形式の index が残っていても無視する。
- `goTo(fileName, viewIndex)`: 引数の `viewIndex` を「表示位置」とする。範囲チェックは `viewLength(fileName)` で行う。**コメントと型表記で「表示位置」と明記する。**

### Task 3: `preferences.js` の接続

- アプリ起動時に `createPreferences()` を生成して `main.js` に渡す（R6）。`main.js` から `localStorage` を直接参照しない。
- 読み込んだ文字列は `parseSpecString` で検証し、不正なら `[]`。

### Task 4: `ui.js` — ソートUI

- 配置: 位置表示「12 / 340 件」の近く。ジャンプ・検索のナビゲーションパネルとは**別のコンパクトな1行**にする。
  - 表示例: `並び順: チャンネル → 曲名 ▾`（プリセット選択）と、`⇅`（反転ボタン）
- プリセットの選択肢は `main.js` から渡されたデータ（`{ id, label }` の配列と現在の id）で生成する。**ui.js は `sort.js` を import しない**（R3）。
- 現在の spec がどのプリセットにも一致しない場合（将来のカスタム設定）は「カスタム」と表示する。
- 現在のレコードの表示が変わらない場合に YouTube 埋め込みを再生成しないこと（§1.7）。
- 並び順の `<select>` にフォーカス中、分類ショートカットが発動しないこと（既存のガードの対象に `select` を含める）。
- ボタン・セレクトは Android での操作を考慮し、十分なタップ領域を確保する。
- 既存のDOM構築・イベント配線のスタイルに合わせる。

### Task 5: ジャンプ・検索との整合

**ジャンプ**
- 「N件目」「最大値」は表示位置基準（`viewLength`）。
- ジャンプUIに現在の並び順名を併記し、「N件目」が並び順に依存することが分かるようにする。

**検索**（実装済みの場合は修正、未実装の場合は実装時の指示として扱う）
- `SEARCH_FEATURE_SPEC.md` のプロパティ名を本書の実名に読み替える。
  - 動画ID → `getVideoId`
  - タイトル検索 → **`title_clean` と `title_raw` の両方**を対象（`getTitle` と `getTitleRaw`）
  - チャンネル名 → `getChannel`
  - 任意でアーティスト → `getArtist`
- 検索結果の同一性は `video_id` で持つ（`index` を保持しない方針は変更なし）。
- 結果の `(file, index)` の `index` は**表示位置**とし、`inverse` から求める。結果のクリックは `goTo(file, viewIndex)`。
- 結果の並びは各ファイルの `order` に従って走査し、現在のソート順に自然にそろえる（`searchAll` には `orders`（`{ [file]: number[] }`）をオプション引数で渡す。`search.js` 自体は `state` に依存させない＝R1）。

### Task 6: ドキュメント更新（`PROJECT_FLOW.md`）

- 「ソート（表示順）フロー」を追加する。
  流れ: `UI → actions.setSort → setSort → normalizeSpec → rebuildView(全ファイル) → 現在レコードの位置引き直し → preferences保存 → render`
- 「`state.index` は表示位置であり、データ位置は `order` で変換する」ことを明記する。
- §2 の構成図・責務表に `record-fields.js` / `sort.js` / `view-order.js` / `preferences.js` を追加し、依存ルール R1〜R6 を記載する。
- 分類フロー（§5）・Undoフロー（§6）の記述のうち、位置の扱いが変わる部分を修正する。
- 既存の Mermaid 記法・文体に合わせる。

---

## 5. 既存機能との競合チェックリスト

| 対象 | リスク | 対応 |
| :--- | :--- | :--- |
| `state.index` の直接参照 | データ添字として使うと別レコードを操作する（**誤分類につながる最重要リスク**） | `grep` で全参照を洗い出し、`order` 経由に置換。テストで確認 |
| `applyMoveInMemory` | 削除位置の誤り | `order[src][state.index]` で解決。終了後に `rebuildView(src, dst)` |
| Undo | 履歴の旧 index を使うと位置ズレ | 履歴の index は使わず、`video_id` で再配置 |
| 分類後の位置 | 移動後に違う曲が表示される | `index` は変えない（再構築後、同位置に次の曲） |
| 終端状態 | `order` 範囲外アクセスで例外 | `getRecordAt` が範囲外で null を返す。UIは既存の終端表示を維持 |
| ソート変更中の `busy` | Undo中の位置ズレ | `busy` 中は拒否 |
| YouTube埋め込み | ソート変更・再描画で再読込 | `video_id` が同じなら再生成しない |
| ジャンプ / 検索 | 「N件目」の基準不一致 | すべて表示位置基準（Task 5） |
| 書き込みキュー / 履歴 / バックアップ | なし | 触らない |
| ショートカット | `select` 操作中に分類が発動 | ガード対象に `select` を追加 |

---

## 6. 禁止事項

- ソートによってメモリ上のデータ配列・JSONLファイル・`channel_labels.json` の順序を変更しない。
- `writeQueue` / `history.js` / `file-system.js` / `jsonl-store.js` / `backup.js` を変更しない。
- 日付を**文字列比較**でソートしない（ミリ秒なしの値が混在する）。
- 空値（null・空文字）を降順で先頭に出さない。
- `Intl.Collator` を採用しない（Unicode順で決定済み）。読み（ふりがな）データの追加もしない。
- domain 層から DOM・`window`・`localStorage`・IndexedDB・`state` を参照しない（R1）。
- `ui.js` から `sort.js` 等の domain 層を import しない（R3）。
- 履歴（IndexedDB）に保存された旧 index に依存しない。
- 外部ライブラリ・CDN を追加しない（完全ローカル完結の設計思想に反する）。

---

## 7. 受け入れ基準 / テスト項目

### 7.1 domain 単体テスト（自動）
- [ ] `toSortText`: 全角英数→半角、大文字→小文字、先頭の `【` `[` `「` 絵文字・空白が除去される。全部記号なら元の文字列。空・空白のみは null
- [ ] 日付: ミリ秒なし（`...56Z`）とありが混在しても、時刻順に正しく並ぶ。不正な日付文字列は null として末尾
- [ ] **空値は昇順・降順のどちらでも末尾**（空の `channel`、`artist_guess: null`）
- [ ] `channel_title` プリセット: 同一チャンネルが連続し、その中が曲名順になる。**同名で別URLのチャンネルが混ざらない**
- [ ] 全段同値のとき、元のデータ位置の昇順になる（同じ入力で常に同じ結果）
- [ ] `spec = []` で恒等写像
- [ ] `invertOrder(order)` が逆写像になっている
- [ ] `normalizeSpec` / `parseSpecString`: 未知のキー、不正な方向、4段以上、重複キー、壊れた文字列が null になる。`serializeSpec` との往復で値が一致する
- [ ] `reverseSpec` が全段の `dir` を反転し、元の spec を変更しない
- [ ] 入力の `records` 配列・レコードが変更されない

### 7.2 UI・結合（手動）
- [ ] 各プリセットで正しい順序に並ぶ。ファイル順に戻すと元の順序に戻る
- [ ] ソート変更後も、表示中の曲が変わらず（位置だけ更新され）、YouTube埋め込みが再読込されない
- [ ] **ソート中に分類したとき、表示していた曲が正しい移動先に入り、移動元の次の曲が表示される**（別の曲が誤って移動しない）
- [ ] 移動先ファイルで、移動した曲がそのファイルのソート順に従った位置に入る
- [ ] ソート中の 分類 → Undo で、元の曲が復元され、選択されている
- [ ] 最後の1件を分類した直後（終端状態）にソートを変更してもエラーが出ない。0件のファイルでも崩れない
- [ ] ジャンプの「N件目」と位置表示が現在の並び順基準で一致する
- [ ] 検索結果のクリックで正しい曲へ移動し、結果の「N件目」が現在の並び順基準である
- [ ] ソート設定が再起動後に復元される。保存値が壊れていてもアプリが起動し、ファイル順で表示される
- [ ] `busy` 中のソート変更が拒否される
- [ ] ソート操作中に `writeQueue` が空のまま（ファイル書き込みが一切発生しない）
- [ ] ソートUIの操作中に分類ショートカットが発動しない
- [ ] 既存の分類・Undo・ジャンプ・検索・チャンネル判定・バックアップが従来どおり動作する
- [ ] 数万件規模のデータでも、ソート切替と分類後の再構築が体感で遅くならない（遅い場合は報告）

---

## 8. 最終報告に含めること

- 変更・追加したファイルと変更概要
- `state.index` を参照していた箇所の一覧と、それぞれの修正内容（特に `applyMoveInMemory` と Undo）
- 実コードと本仕様の食い違い（名前・データ配列の変更方式・履歴のフィールド・終端状態の扱いなど）
- §7 のテスト結果と、単体テストの実行方法
- 依存ルール R1〜R6 を満たしていること（`import` 関係の確認結果）
- 仕様に無い判断をした箇所とその理由
- 未解決の懸念点（レコードをその場で書き換える処理の有無を含む）

---

## 9. 将来の拡張候補（今回は実装しない）

- キーを最大3段まで自由に組み合わせるカスタムソートUI（domain は任意の `spec` に対応済みなのでUI追加のみ）
- JSONLに読み（`title_yomi` 等）を追加し、五十音順にする（`toSortText` の入力を差し替えるだけで対応可能）
- 分類時の `order` の差分更新（削除は `splice`、追加は二分探索挿入）による高速化
- ファイル順の逆順（追加が新しい順）
- ソート設定のURLクエリ化（実サイト移行時。`serializeSpec` / `parseSpecString` をそのまま利用）
