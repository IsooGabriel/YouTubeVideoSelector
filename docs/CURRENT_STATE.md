# 現行アプリの状態（Phase 0）

確認日: 2026-11-04。実データは読まず、リポジトリ内のコードと合成サンプルだけを確認した。

## 構成

現行アプリは Vite 7 と ES Modules によるPWAであり、React / TypeScript への移行はまだ行われていない。`src/main.js` が状態と操作を管理し、`src/ui.js` がDOMを描画する。

| モジュール | 現在の責務 |
| --- | --- |
| `main.js` | 状態、接続、書込みキュー、分類、Undo、ジャンプ、ソート、表示更新 |
| `ui.js` | 画面描画とイベント配線。検索結果は最大50件ずつ表示 |
| `file-system.js` | フォルダ権限、4分類JSONLの読書き、ディレクトリハンドル保存 |
| `jsonl-store.js` | JSONL読込・書出、破損行検出、指紋、重複検出、移動計画 |
| `history.js` | IndexedDB上の最大20件のUndo履歴 |
| `channel-labels.js` | `channel_labels.json` のチャンネル単位判定 |
| `backup.js` | 4分類JSONLとチャンネル判定のZIPバックアップ |
| `record-fields.js` | 外部レコードの安全なフィールド読取 |
| `sort.js` / `view-order.js` | 表示順だけを変える純粋なソート処理 |
| `search.js` | 正規化・検索・URLからの動画ID抽出を行う純粋処理 |
| `preferences.js` | ソート設定のローカル保存 |

## 状態と表示位置

`state` の中心は `data`（ファイル名ごとの `{ records, text, fingerprint }`）、`file`、`index`、`view.order`、`view.inverse` である。`index` は元配列の位置ではなく**表示位置**であり、現在レコードは `view.order[file][index]` を介して取得する。

`state.index` は次で使われる。

- 現在レコードの取得、表示位置の件数表示、検索結果の現在位置表示
- 分類後の次レコードの選択
- Undo後の復帰位置
- ジャンプ、検索結果を開く、ファイル切替
- ソート変更後に同じ動画を再探索して位置を復元

## 分類・Undo・保存の流れ

分類では `applyMoveInMemory` が移動元から対象を除き、移動先配列の末尾に追加する。両ファイルをJSONLへ全量シリアライズし、`writeQueue` へ入れる。キューは同一ファイルの未保存内容を最新のものへ集約して順に保存する。Undoも同じ関数を逆方向に使うため、復帰先は元ファイルの末尾になる。

Undo履歴は IndexedDB の `music-selector/history` に `{ source, destination, record, createdAt }` として保存され、古いものを削除して最大20件に保つ。現在の履歴には元の位置情報がないため、移動→Undoで元の行位置へ完全復帰する保証は未確認である。

## 既知の差分・注意点

- `main.js` の実際の移動処理は `jsonl-store.js` の `planMove` を使っていない。重複検出と保存前の往復検証を実運用でどこまで行えているかは、Phase 1でテストと実データコピーにより確認する。
- `jsonl-store.js` のシリアライズはJSONを再構成するため、キー順・空白・改行形式・BOMを含むバイト一致は保証しない。
- `ui.js` の一部はテンプレート文字列で構成されるが、外部データはエスケープまたは `textContent` を使用して描画している。
- Service Worker/manifestのURLが Vite の公開先 `base` と整合するかは、公開環境で未確認。

## 現在の検証

既存テストは Node 標準テストランナーで、JSONL、ソート、検索、ジャンプを対象にしている。React、TypeScript、Vitest、ESLint、Prettierは未導入または未設定である。Phase 1のゲートまでは、既存の保存経路を置き換えない。
