# YouTube履歴ビューアー / 統合機能 設計メモ

-   文書種別: 技術スタック・基本設計
-   作成日: 2026-11-04
-   ステータス:
    初期案（実装前に既存のファイル変更機能との接続点を確認する）

## 1. 目的とスコープ

### 目的

YouTubeの再生履歴を一覧で確認し、履歴に含まれる情報やユーザー付与タグを使って検索・絞り込みできる機能を開発する。既存の「ユーザーファイルを読み込み、内容を変更して保存する機能」と統合し、履歴の閲覧だけでなく既存データの編集ワークフローにも接続する。

将来的にコメント一覧やYouTube以外のサービスのデータも扱えるよう、サービス固有のデータ形式と画面・検索機能を分離する。

### 今回の対象

1.  YouTube再生履歴の一覧表示
2.  タグ、名前、その他の詳細情報による検索
3.  条件によるフィルター
4.  既存のユーザーファイル変更機能との統合
5.  将来のコメント・他サービス追加を考慮した拡張可能な設計

### 今回は対象外

-   YouTubeへのログインや公式APIを使った履歴の直接取得
-   YouTube上のコメント投稿・削除
-   サーバーへのユーザーデータ同期
-   複数ユーザー間の共有・権限管理
-   高度な全文検索エンジンの導入

入力データは、まずユーザーが所有するGoogle
Takeout由来ファイルや既存JSONLファイルを想定する。

## 2. 推奨技術スタック

### フロントエンド

  -------------------------------------------------------------------------------------------------
  技術                    用途                       採用理由
  ----------------------- -------------------------- ----------------------------------------------
  HTML                    ページ構造                 Web標準

  CSS                     レイアウト・装飾           標準技術で管理

  TypeScript              アプリケーションロジック   データ形式・型の安全性

  React                   UI構築                     一覧、検索条件、詳細表示を部品化

  Vite                    開発サーバー・ビルド       軽量でReact/TypeScriptとの相性がよい

  React Router            画面遷移                   画面数が増えた段階で導入。初期は必須ではない
  -------------------------------------------------------------------------------------------------

### データ・ファイル処理

  ---------------------------------------------------------------------------------------------------
  技術                    用途                                   方針
  ----------------------- -------------------------------------- ------------------------------------
  JSON / JSONL            入出力データ                           元データを保持しつつ内部形式へ変換

  File System Access API  ユーザーが選択したファイルの読み書き   対応ブラウザーで利用

  IndexedDB               一時データ・設定・作業状態             必要になった段階で導入

  Blob / File API         ファイル読み込み・ダウンロード         File System Access API非対応時の代替
  ---------------------------------------------------------------------------------------------------

### 品質・開発補助

  技術                    用途
  ----------------------- -------------------------------------------------------
  ESLint                  静的解析・コード規約
  Prettier                コード整形
  Vitest                  単体テスト
  React Testing Library   UIコンポーネントのテスト
  Playwright              ブラウザー操作を含むE2Eテスト。必要になった段階で導入
  Git / GitHub            バージョン管理・変更履歴

### Dockerの扱い

初期版はフロントエンド中心のため、Node.js +
npmだけで開発・ビルドできる。Dockerは必須にしない。

将来、ローカルバックエンド、データベース、複数サービス連携などを追加する場合に、開発環境をDocker
Composeで統一する。Dockerを導入しても、ブラウザーからユーザーの任意ファイルへ直接アクセスできるようになるわけではない点に注意する。

## 3. 全体構成

初期段階では、単一のViteプロジェクト内にフロントエンド機能をまとめる。

``` text
[ユーザーのファイル]
       |
       v
[File Access 層]
       |
       v
[Importer / Parser]
       |
       v
[サービス別 Adapter]
       |
       v
[共通データモデル]
       |
       +------> [検索・フィルター]
       |                 |
       |                 v
       |           [履歴一覧 UI]
       |
       +------> [既存ファイル編集機能]
                         |
                         v
                  [保存・書き出し]
```

重要な設計方針:

-   ReactコンポーネントからファイルAPIを直接呼ばない。
-   JSON/JSONLの解析と画面表示を分離する。
-   YouTube固有の形式を、画面全体に広げない。
-   既存ファイルの形式や編集ルールを勝手に変更しない。
-   読み込み時の元データを保持し、保存時に必要な差分だけを反映できる構造にする。

## 4. ディレクトリ構成案

``` text
youtube-history-app/
├─ public/
│  ├─ icons/
│  └─ manifest.webmanifest
│
├─ src/
│  ├─ app/
│  │  ├─ App.tsx
│  │  ├─ router.tsx
│  │  └─ providers/
│  │
│  ├─ components/
│  │  ├─ common/
│  │  │  ├─ Button.tsx
│  │  │  ├─ Input.tsx
│  │  │  └─ Loading.tsx
│  │  ├─ layout/
│  │  └─ feedback/
│  │
│  ├─ features/
│  │  ├─ history/
│  │  │  ├─ components/
│  │  │  │  ├─ HistoryList.tsx
│  │  │  │  ├─ HistoryItem.tsx
│  │  │  │  ├─ HistoryDetail.tsx
│  │  │  │  └─ HistoryToolbar.tsx
│  │  │  ├─ hooks/
│  │  │  ├─ historyFilters.ts
│  │  │  └─ historyTypes.ts
│  │  │
│  │  ├─ search/
│  │  │  ├─ SearchBar.tsx
│  │  │  ├─ FilterPanel.tsx
│  │  │  └─ searchHistory.ts
│  │  │
│  │  └─ file-editor/
│  │     ├─ components/
│  │     ├─ editorTypes.ts
│  │     └─ editorService.ts
│  │
│  ├─ domain/
│  │  ├─ models/
│  │  │  ├─ MediaItem.ts
│  │  │  ├─ Tag.ts
│  │  │  └─ ServiceSource.ts
│  │  └─ ports/
│  │     └─ HistoryRepository.ts
│  │
│  ├─ services/
│  │  ├─ youtube/
│  │  │  ├─ youtubeTakeoutParser.ts
│  │  │  ├─ youtubeJsonlParser.ts
│  │  │  └─ youtubeAdapter.ts
│  │  └─ comments/
│  │     └─ (将来追加)
│  │
│  ├─ infrastructure/
│  │  ├─ file/
│  │  │  ├─ FileAccess.ts
│  │  │  ├─ browserFileAccess.ts
│  │  │  ├─ downloadFileAccess.ts
│  │  │  └─ jsonlCodec.ts
│  │  └─ storage/
│  │     └─ (必要になった段階で追加)
│  │
│  ├─ styles/
│  ├─ utils/
│  ├─ main.tsx
│  └─ vite-env.d.ts
│
├─ tests/
│  ├─ fixtures/
│  ├─ parsers/
│  └─ integration/
│
├─ .env.example
├─ .gitignore
├─ Dockerfile                 # Dockerを使う段階で追加
├─ compose.yaml               # バックエンド追加時などに追加
├─ eslint.config.js
├─ index.html
├─ package.json
├─ package-lock.json
├─ tsconfig.json
├─ vite.config.ts
└─ README.md
```

初期実装ですべてのファイルを作る必要はない。機能が必要になったタイミングでディレクトリやファイルを追加する。特に
`comments/` やDocker関連ファイルは将来用の配置例である。

## 5. 共通データモデル

画面や検索処理は、Google
Takeoutの生データ形式に直接依存しないようにする。各入力形式を共通モデルへ変換する。

``` ts
export type MediaItem = {
  id: string;
  source: "youtube" | string;
  kind: "video" | "comment" | string;

  title: string;
  url?: string;
  channelName?: string;
  channelUrl?: string;

  tags: string[];

  playedAt?: string;
  firstPlayedAt?: string;
  lastPlayedAt?: string;
  playCount?: number;

  description?: string;
  details?: Record<string, unknown>;

  // 元データを復元・編集するための情報
  raw?: unknown;
};
```

このモデルは初期案。既存JSONLの実フィールドと既存編集機能を確認してから確定する。

### YouTube Takeoutの入力例

Google TakeoutのMy
Activity由来データでは、一般に次のような項目が含まれる。

-   `title`: 視聴内容を表すタイトル
-   `titleUrl`: 動画URL
-   `subtitles`: チャンネル名やチャンネルURL
-   `time`: 視聴日時
-   `header`, `products`, `activityControls`: データの種別・付帯情報

データによって任意項目や形式の違いがあるため、欠損値を許容する。視聴履歴以外のアクティビティが混在する可能性も考慮し、動画履歴として判定できないレコードは無理に変換せず、読み込みエラーまたは未分類データとして扱う。

### 既存JSONLとの互換性

既存データには、例えば次のような項目があることを前提にする。

-   `video_id`
-   `url`
-   `title_raw`
-   `channel`
-   `channel_url`
-   `signals`
-   `warnings`
-   `play_count`
-   `first_played`
-   `last_played`

これらは既存形式のまま読み書きできるようにし、内部モデルへの変換はAdapterに閉じ込める。既存の
`likely.jsonl`、`possible.jsonl`、`unknown.jsonl`、`excluded.jsonl`
などの分類ファイルが現在も使われている場合、ファイル名・分類意味・レコード形式を維持する。実際の最新仕様を確認せずに新形式へ一括変換しない。

## 6. 一覧・検索・フィルター仕様

### 一覧表示

各履歴項目に表示する基本情報:

-   タイトル
-   チャンネル名
-   視聴日時
-   再生回数（データに存在する場合）
-   タグ
-   詳細画面を開く操作

タイトルやチャンネル名にURLが存在する場合は、リンクとして扱う。画面幅が狭い場合は情報を段階的に表示し、一覧の視認性を優先する。

### 検索対象

-   タイトル・名前
-   チャンネル名
-   タグ
-   URL / video ID
-   詳細情報（必要な項目を明示して対象化）

初期版では部分一致を基本とし、大文字・小文字や前後の空白の差を吸収する。日本語の検索では、過度な形態素解析などを初期段階から導入せず、まず通常の文字列検索で実装する。

### フィルター候補

-   タグ
-   チャンネル
-   視聴日時の範囲
-   再生回数の範囲
-   データソース
-   レコード種別
-   既存分類（既存ファイルに分類情報がある場合）

検索文字列と複数フィルターは組み合わせて適用する。フィルター条件の解除と、該当件数の表示を用意する。

### 実装方針

最初はメモリ上の配列に対する検索・絞り込みで十分。データ量が増え、実測で性能問題が出た場合に、仮想スクロール、Web
Worker、検索ライブラリなどを検討する。初期段階から検索エンジンやデータベースを導入しない。

## 7. 既存ファイル編集機能との統合

### 境界を明確にする

履歴ビューアーは「データを探して選択する機能」、既存ファイル編集機能は「ユーザーデータを変更して保存する機能」として分離する。

両者は共通の `MediaItem`
または既存機能が定義する正式な型を介して連携する。ビューアー側で既存のファイル保存処理を再実装しない。

### ファイルアクセスの設計

ファイルアクセスは `FileAccess` インターフェースに集約する。

``` ts
export interface FileAccess {
  readText(file: File): Promise<string>;

  // 実際の書き込み方法は、選択されたファイルハンドル等に応じて実装する
  writeText?(target: unknown, content: string): Promise<void>;
}
```

上記は境界の考え方を示す簡略例であり、実装時には既存編集機能のAPIに合わせて型を確定する。

ブラウザーでは、ユーザーが明示的に選択したファイルだけを読み書きする。File
System Access
APIが使える環境では、ユーザーの許可を得て選択ファイルへ書き戻す。非対応環境では、編集結果を新しいファイルとしてダウンロードする方式にフォールバックする。

ブラウザーの制約上、Webアプリがユーザーの端末内の任意ファイルを許可なく探索・変更することはできない。スマートフォンを含む各ブラウザーで、ファイル選択・再アクセス・書き戻しの対応状況を実機確認する。

### データ保護ルール

-   読み込んだ元ファイルを、保存操作なしに変更しない。
-   保存前に変更内容・対象ファイルを確認できるようにする。
-   既存レコードの未知フィールドを不用意に削除しない。
-   JSONLの1行1レコード形式、文字コード、改行形式を既存仕様に合わせる。
-   書き込み失敗時に、成功したように表示しない。
-   可能なら保存前バックアップ、または別名保存を提供する。
-   重複レコードやID衝突を検出できるようにする。

## 8. 将来拡張

### コメント一覧

コメントを動画履歴と同じ `MediaItem`
に無理に押し込まず、コメント固有の型を定義する。共通検索・タグ付け・一覧UIで再利用できる部分は共通化する。

``` ts
export type CommentItem = {
  id: string;
  source: string;
  videoId?: string;
  videoTitle?: string;
  authorName?: string;
  text: string;
  createdAt?: string;
  tags: string[];
  raw?: unknown;
};
```

### 他サービス

サービスごとにParser / Adapterを追加し、共通モデルへ変換する。

``` text
services/
├─ youtube/
│  ├─ youtubeTakeoutParser.ts
│  └─ youtubeAdapter.ts
├─ another-service/
│  ├─ parser.ts
│  └─ adapter.ts
└─ comments/
   └─ commentAdapter.ts
```

サービス固有のフィールドや制約は各Adapterで扱い、画面側にサービスごとの条件分岐が増え続けないようにする。

## 9. セキュリティ・プライバシー

-   初期版はローカル処理を基本とし、履歴データを外部サーバーへ送信しない。
-   APIキー、個人情報、履歴データをGitへコミットしない。
-   ログに動画タイトル、コメント本文、ユーザー情報などを不用意に出力しない。
-   外部リンクは適切なリンク属性を設定する。
-   読み込んだJSON/JSONLは信頼できない入力として扱い、型・サイズ・必須項目を検証する。
-   HTMLとして文字列を直接挿入せず、Reactの通常のテキスト描画を利用する。

## 10. 開発・実装順序

### Phase 1: 既存機能の把握

1.  既存ファイル編集機能のソース・データ形式・保存処理を確認する。
2.  現在利用しているJSONLの実例を確認する。
3.  ファイルの読み込み・書き戻しが動作するブラウザーを確認する。
4.  共通データモデルとAdapterの責務を確定する。

### Phase 2: 基本基盤

1.  Vite + React + TypeScriptプロジェクトを構築する。
2.  ESLint / Prettier / Vitestを設定する。
3.  共通型とYouTube入力Parserを実装する。
4.  テスト用の匿名化データを用意する。

### Phase 3: 履歴ビューアー

1.  ファイル読み込み
2.  履歴一覧表示
3.  詳細表示
4.  タイトル・チャンネル・タグ等の検索
5.  タグ・日時・チャンネル等のフィルター
6.  件数表示・条件クリア

### Phase 4: 既存編集機能との統合

1.  既存編集機能を呼び出す境界を作る。
2.  選択した履歴レコードを既存編集機能へ渡す。
3.  編集結果を一覧へ反映する。
4.  保存・エラー・バックアップの挙動を検証する。
5.  既存ファイルとの互換性テストを行う。

### Phase 5: 拡張準備

1.  コメント用Adapter / モデルを追加する。
2.  別サービス用Adapterを追加する。
3.  必要性が出たらIndexedDB、Web
    Worker、Dockerバックエンド等を検討する。

## 11. 初期セットアップ

Node.js LTSとnpmがインストールされていることを前提とする。

``` bash
npm create vite@latest youtube-history-app -- --template react-ts
cd youtube-history-app
npm install
npm run dev
```

品質管理ツールの追加:

``` bash
npm install -D eslint prettier vitest
```

React Testing Libraryなどは、UIテストを実装する段階で追加する。

主なnpm scriptsの想定:

``` json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "test": "vitest"
  }
}
```

## 12. 完了条件（初期版）

-   [ ] 対応するYouTube履歴ファイルを読み込める。
-   [ ] 不正・未対応レコードを識別し、処理結果をユーザーに示せる。
-   [ ] 履歴を一覧表示できる。
-   [ ] タイトル、チャンネル名、タグ、詳細情報から検索できる。
-   [ ] 複数条件のフィルターを組み合わせられる。
-   [ ] 一覧から既存編集機能へ対象レコードを渡せる。
-   [ ] 既存ファイルの形式と未知フィールドを壊さず保存できる。
-   [ ] 保存前後の件数・エラーを確認できる。
-   [ ] 対象ブラウザーでファイルの読み書きができるか確認済み。
-   [ ] 履歴データが意図せず外部送信されない。

## 13. 実装開始前に確定すること

1.  既存のファイル編集機能は、同じVite/Reactプロジェクト内にあるか、別プロジェクト・別アプリか。
2.  既存機能が扱う正式なファイル形式とスキーマ（JSONLの各フィールド、分類ファイル名、タグの保存先）。
3.  「名前」が動画タイトル、チャンネル名、ユーザーが付けた名前のどれを指すか。初期案ではタイトルとチャンネル名の両方を対象とする。
4.  主な利用環境（Windowsデスクトップ、Androidスマートフォン、両方）。
5.  編集結果を元ファイルへ直接書き戻す必要があるか、別ファイルへの書き出しでもよいか。

これらは設計を大きく左右するため、既存実装を確認してから決める。特にファイル書き戻し方式はブラウザーごとの差が大きい。
