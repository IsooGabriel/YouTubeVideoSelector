# YouTube Video Selector 全体処理フロー設計書

本ドキュメントは、**YouTube Video Selector（YouTube Music Selector）** のシステムアーキテクチャ、画面遷移、データ処理、例外処理などの全体フローをまとめた技術仕様・フローガイドです。

---

## 1. プロジェクト概要

### 1.1 目的
Android端末などのローカルストレージにある YouTube 視聴履歴（JSONL形式）を、1件ずつ確認しながら「楽曲候補」や「対象外」へ安全かつ直感的に分類するオフライン対応PWA（Progressive Web App）です。

### 1.2 コア設計思想
- **完全ローカル完結**: サーバー通信・外部CDN・アクセス解析を一切行わない。
- **データ破壊防止（Safety First）**:
  - 元データのプロパティ構造を完全に保持。
  - 不正行・破損JSONの検知と書き込み中断。
  - メモリ即時更新＋バックグラウンドキューによる快適なUIと整合性の両立。
- **PWA / オフライン動作**: Service Workerによる静的リソースのプリキャッシュにより、通信が切断された状態でも分類・Undo・バックアップが可能。
- **File System Access API & IndexedDB**:
  - ローカルフォルダへの直接読み書き。
  - フォルダハンドルおよびUndo履歴（最大20件）を IndexedDB に永続化。

---

## 2. システム構成とモジュール責務

```mermaid
graph TD
    subgraph UI/View
        UI[src/ui.js<br/>DOM構築・イベント配線]
    end

    subgraph State & Orchestration
        MAIN[src/main.js<br/>状態管理・書込キュー・コントローラ]
    end

    subgraph Core Modules
        FS[src/file-system.js<br/>File System Access API / IndexedDB保存]
        STORE[src/jsonl-store.js<br/>JSONLパース・シリアライズ・検証]
        SEARCH[src/search.js<br/>純粋検索ロジック・正規化・WeakMapキャッシュ]
        CH[src/channel-labels.js<br/>channel_labels.json 読み書き]
        HIST[src/history.js<br/>Undo履歴管理（IndexedDB: 最大20件）]
        BACKUP[src/backup.js<br/>ZIP生成（純粋JS/ストア方式）]
    end

    UI -->|ユーザー操作イベント| MAIN
    UI -->|クエリ解析・検索実行| SEARCH
    MAIN -->|状態を渡して描画更新| UI
    MAIN --> FS
    MAIN --> STORE
    MAIN --> CH
    MAIN --> HIST
    MAIN --> BACKUP
    FS --> STORE
    CH --> FS
    BACKUP --> FS
```

### 2.1 モジュール別役割一覧

| モジュール | 主な役割・責務 |
| :--- | :--- |
| `src/main.js` | アプリケーションのエントリーポイント。全体状態 (`state`) の保持、書き込みキュー (`writeQueue`) の制御、イベントハンドラの実装、`goTo` による安全な位置移動制御、検索状態管理 (`setSearch`, `openResult`)。 |
| `src/ui.js` | 画面全体のHTMLレンダリング、ナビゲーションパネル（ジャンプ・検索タブUI）、検索結果の部分更新、入力中判定ヘルパー (`isTypingTarget`)、YouTube埋め込み制御、各種DOMイベント配線。 |
| `src/search.js` | 検索クエリ解析、NFKC・小文字・ひらがなカタカナ正規化、YouTube URL からの動画ID抽出、レコードマッチング、WeakMap による正規化キャッシュ（純粋関数）。 |
| `src/file-system.js` | File System Access API を用いたファイル・フォルダハンドルの操作、読み書き、IndexedDBへのハンドル永続化。 |
| `src/jsonl-store.js` | JSONLテキストとオブジェクト配列の相互変換、空行スキップ、破損行検知 (`JsonlError`)、ハッシュ指紋生成。 |
| `src/channel-labels.js` | チャンネル単位の判定情報 (`channel_labels.json`) の読み込みおよび安全な更新。 |
| `src/history.js` | 移動履歴（最大20件）を IndexedDB (`music-selector` / `history`) に保存・取得・削除。 |
| `src/backup.js` | 外部ライブラリを使わずに標準API (Uint8Array, Blob, TextEncoder) だけでZIPバイナリを構築してエクスポート。 |

---

## 3. アプリ起動と初期化フロー

アプリを開いた際の自動接続・初期フォルダ検証フローです。

```mermaid
sequenceDiagram
    autonumber
    actor User as ユーザー
    participant Main as main.js
    participant FS as file-system.js
    participant IDB as IndexedDB
    participant Disk as ローカルストレージ

    User->>Main: アプリをブラウザ/PWAで開く
    Main->>FS: supportsFileAccess() 検査
    alt 非対応ブラウザ
        Main-->>User: 「直接ファイルを編集できません」警告表示
    else 対応ブラウザ
        Main->>FS: loadHandle()
        FS->>IDB: 保存された directory handle を取得
        alt ハンドルが存在し、権限あり
            Main->>Main: connect(handle, ask=false)
            Main->>FS: ensureFiles(handle)
            Main->>Disk: 各JSONL・channel_labels.json読み込み
            Main->>Main: state.data / state.labels を初期化
            Main-->>User: メイン分類画面を描画
        else ハンドルなし / 権限未取得
            Main-->>User: 「データフォルダを選択」画面を描画
        end
    end
```

---

## 4. データフォルダの選択・接続フロー

初回利用時、またはフォルダ再選択時の詳細フローです。4つの必須ファイル（`likely.jsonl`, `possible.jsonl`, `unknown.jsonl`, `excluded.jsonl`）の存在確認と不足時の自動生成を行います。

```mermaid
flowchart TD
    Start([「データフォルダを選択」押下]) --> Picker[showDirectoryPicker readwrite 呼び出し]
    Picker -->|キャンセル| Abort[「フォルダ選択をキャンセルしました」表示]
    Picker -->|フォルダ選択成功| CheckPerm{読み書き権限確認}
    
    CheckPerm -->|未許可/拒否| PermErr[エラー: 読み書き権限がありません]
    CheckPerm -->|許可| CheckFiles[ensureFiles: 4つのJSONL存在確認]

    CheckFiles --> HasMissing{不足ファイルがあるか?}
    HasMissing -->|なし| ReadAll[各JSONLおよび channel_labels.json 読込]
    HasMissing -->|あり| ConfirmCreate{空ファイル作成の確認ダイアログ}
    ConfirmCreate -->|いいえ| MissingErr[エラー: 必要な分類先ファイルがありません]
    ConfirmCreate -->|はい| CreateFiles[不足している空JSONLを作成] --> ReadAll

    ReadAll --> ParseCheck{JSONL構文チェック}
    ParseCheck -->|不正行あり| SyntaxErr[JsonlError: 行番号・ファイル名を表示して中断]
    ParseCheck -->|正常| SaveHandle[IndexedDB にディレクトリハンドル保存]
    SaveHandle --> Ready[state.ready = true / 初期分類対象を表示]
```

---

## 5. 楽曲分類（レコード移動）フロー

分類ボタンを押した際の処理シーケンスです。  
**メモリ即時反映（楽観的UI更新）** と **非同期書き込みキュー（FIFO集約）** により、軽快な操作感を保ちながらファイル不整合を防止します。

```mermaid
sequenceDiagram
    autonumber
    actor User as ユーザー
    participant UI as ui.js
    participant Main as main.js
    participant Queue as 書き込みキュー (writeQueue)
    participant Hist as history.js (IndexedDB)
    participant Disk as ファイルシステム

    User->>UI: 分類ボタン押下 (移動先: dstName)
    UI->>Main: actions.move(destination)
    
    alt 移動先が現在と同じファイル
        Main->>Main: state.index を +1 してスキップ表示
    else 異なるファイルへ移動
        Main->>Main: applyMoveInMemory(srcName, dstName, record)
        Note over Main: 1. メモリ上で移動元から削除<br/>2. 移動先へレコード追加<br/>3. JSONL文字列へシリアライズ
        Main->>Queue: enqueueWrite(srcName, text)
        Main->>Queue: enqueueWrite(dstName, text)
        Main->>UI: render(root, state) 【即時描画・次の曲へ】
        Main->>Hist: addHistory({source, destination, record})
        
        par バックグラウンド保存
            Queue->>Disk: writeText(srcName) (createWritable -> write -> close)
            Queue->>Disk: writeText(dstName) (createWritable -> write -> close)
            Queue-->>Main: 保存完了 (state.syncing = false)
        end
    end
```

### 5.1 同時書き込み・離脱防止の仕組み
- **キューの集約**: 同一ファイルに対する複数回の変更は `writeQueue.set(fileName, text)` により常に最新のシリアライズ文字列に上書き集約され、不要な中間I/Oを省きます。
- **`beforeunload` ガード**: 書き込みキューが残っている状態でタブやブラウザを閉じようとした場合、警告を出してデータ消失を防ぎます。

---

## 6. ジャンプ（位置移動）フロー

現在表示中のファイル内で、指定した「N件目（1始まり）」のレコードへ直接移動する機能です。  
ファイルI/O、IndexedDB履歴、書き込みキューには**一切触れず**、メモリ上の状態変更と画面再描画のみを行います。

```mermaid
sequenceDiagram
    autonumber
    actor User as ユーザー
    participant UI as ui.js (ナビゲーションパネル)
    participant Main as main.js (goTo)

    User->>UI: 件数入力 + 「移動」押下 / Enterキー (または先頭/末尾/±10)
    UI->>Main: actions.jump(n) / actions.goToIndex(index)
    
    alt state.busy === true (Undo中など)
        Main-->>User: 「処理中のため移動できません」通知
    else レコード0件 または 非ready
        Main-->>User: エラー通知 (移動不可)
    else 範囲外 (index < 0 または index >= length) または 不正値 (NaN/小数)
        Main-->>User: 「1〜N の範囲で指定してください」通知 (自動補正せず現状維持)
    else 正常範囲内
        Main->>Main: state.file = fileName, state.index = index, state.embed = false
        Main->>UI: render(root, state)
        Main-->>User: 「N 件目に移動しました」通知 & 対象曲表示
    end
```

### 6.1 設計のポイント
- **「N件目」の定義**: 空行を無視したメモリ上のレコード配列インデックスに 1 を加えた位置（1始まり）。
- **範囲外の非補正**: 誤入力で意図しない位置へ移動する事故を防ぐため、自動クランプは行わずエラーメッセージを出して移動しません。
- **入力確定契機**: `input` イベントによる自動移動は行わず、「移動」ボタン押下または Enter キー確定時のみ実行します（YouTube iframe の多重読み込み防止）。
- **拡張性**: 内部関数 `goTo(fileName, index)` はファイル名を受け取るシグネチャとなっており、将来の複数ファイル横断検索機能からも再利用可能です。

---

## 7. 検索フロー

動画ID・タイトル・チャンネル名をキーワード検索し、結果一覧から該当レコードへ直接ジャンプする機能です。
ファイルI/O、IndexedDB履歴、書き込みキューには**一切触れず**、完全読み取り専用で動作します。

```mermaid
sequenceDiagram
    autonumber
    actor User as ユーザー
    participant UI as ui.js (検索パネル)
    participant Search as search.js
    participant Main as main.js (goTo)

    User->>UI: キーワード入力 (デバウンス250ms / IME確定 / Enter)
    UI->>Search: parseQuery(input)
    alt URL貼り付け検出
        Search-->>UI: { keywords: [], videoId }
    else 通常テキスト
        Search-->>UI: { keywords: [...], videoId: null }
    end

    UI->>Search: searchAll(state.data, parsed, { fields, scope, currentFile })
    Note over Search: WeakMapキャッシュを参照し<br/>NFKC・英大小・ひらがなカタカナ正規化照合
    Search-->>UI: 該当レコード一覧 (file, index, record)
    UI->>UI: renderSearchResults() 【結果リストのみ部分更新】
    UI-->>User: 総件数バッジ・結果一覧表示 (上限50件 + さらに表示)

    User->>UI: 結果行をクリック
    UI->>Main: actions.openResult(file, index)
    Main->>Main: goTo(file, index)
    Main->>UI: render(root, state) 【対象曲表示・検索パネルと結果は維持】
```

### 7.1 設計のポイント
- **派生データとしての結果導出**: レコードの分類やUndoによって配列インデックスが変動するため、検索結果はキャッシュせず、現在の `state.data` から都度導出します。
- **入力フォーカスと埋め込みの保護**: 全画面再描画（`render`）に巻き込まず、結果リスト領域（`#search-results`）のみを in-place に部分更新することで、YouTube iframe の再読み込みや入力中のフォーカス喪失を防ぎます。
- **日本語入力（IME）とデバウンス**: `compositionstart`〜`compositionend` 中は検索を抑制し、通常入力は 250ms のデバウンスで実行します。Enter キー押下時は即時実行されます。
- **XSS防止**: 外部データ（タイトル・チャンネル名）はすべて `textContent` / `document.createElement` を用いて描画し、`innerHTML` による直接展開を行いません。
- **大文字小文字の厳密性**: YouTube の動画IDは case-sensitive なため大文字小文字を区別し、タイトルやチャンネル名は大小文字・全半角・ひらがなカタカナを吸収して照合します。

---

## 8. Undo（取り消し）フロー

直前に行った分類操作を取り消し、元のファイルへレコードを戻します。

```mermaid
sequenceDiagram
    autonumber
    actor User as ユーザー
    participant UI as ui.js
    participant Main as main.js
    participant Hist as history.js (IndexedDB)
    participant Queue as 書き込みキュー

    User->>UI: 「Undo」ボタン押下
    UI->>Main: actions.undo()
    Main->>Main: state.busy = true（ボタン等ロック）
    Main->>Hist: lastHistory() で直近の履歴を取得
    alt 履歴なし
        Main-->>User: 「取り消せる履歴はありません」通知
    else 履歴あり (source, destination, record)
        Main->>Main: applyMoveInMemory(destination, source, record)
        Note over Main: 移動先から削除し、元のファイル末尾へ復帰
        Main->>Queue: 反映内容をキューイング
        Main->>Hist: removeHistory(id)
        Main->>Main: state.file = source, index を復元位置に設定
        Main-->>User: メイン画面更新・通知
    end
    Main->>Main: state.busy = false
```

---

## 9. チャンネル判定フロー

楽曲自体の分類とは独立して、チャンネル単位で「楽曲専用」「楽曲専用ではない」を `channel_labels.json` に記録します。

```mermaid
flowchart TD
    Click[チャンネル判定ボタン押下: true / false / clear] --> CheckURL{channel_urlが存在するか?}
    CheckURL -->|なし| Err[エラー: チャンネルURLがないため判定不可]
    CheckURL -->|あり| Load[channel_labels.json を読込]
    
    Load --> UpdateMap{判定値の処理}
    UpdateMap -->|clear| DeleteKey[labels から該当URLのキーを削除]
    UpdateMap -->|true / false| SetKey[該当URLに channel, music_only, updated_at を設定]
    
    DeleteKey --> WriteJson[channel_labels.json を整形インデント書き込み]
    SetKey --> WriteJson
    WriteJson --> UpdateState[state.labels を更新し画面に即時反映]
```

---

## 10. バックアップ（ZIP生成）フロー

ローカルにある全4つのJSONLファイルと `channel_labels.json` をメモリ上で単一のZIPバイナリにパッケージ化し、ブラウザのダウンロード機能で保存します。

```mermaid
sequenceDiagram
    autonumber
    actor User as ユーザー
    participant Main as main.js
    participant Backup as backup.js
    participant FS as file-system.js
    participant Browser as ブラウザ（ダウンロード）

    User->>Main: 「バックアップZIP」押下
    Main->>Backup: backup(handle)
    loop 4つのJSONL + channel_labels.json
        Backup->>FS: readText(name, required=false)
        FS-->>Backup: ファイルテキスト
        Backup->>Backup: UTF-8バイナリ化 & CRC32計算
    end
    Backup->>Backup: ZIPローカルヘッダ + セントラルディレクトリ + 終端レコードを構築 (Store無圧縮)
    Backup-->>Main: Blob (application/zip)
    Main->>Browser: `<a download="music-selector-backup-YYYY-MM-DD.zip">` を生成して自動クリック
    Browser-->>User: ZIPファイルのダウンロード完了
```

---

## 10. エラーハンドリングと安全性ポリシー

| 発生事象 | 検知箇所 | システムの振る舞い / ユーザーへの提示 |
| :--- | :--- | :--- |
| **ブラウザ非対応** | 起動時 (`supportsFileAccess`) | 「このブラウザでは直接ファイルを編集できません」と通知。 |
| **フォルダ権限失効** | 再接続時 (`permission`) | IndexedDBにハンドルがあっても再許可ダイアログを促す。 |
| **ファイル欠損** | フォルダ接続時 (`ensureFiles`) | 不足ファイル名を明示し、ユーザー承認後にのみ空ファイルを新規作成（既存ファイルは保護）。 |
| **JSONLパースエラー** | 読込時 (`jsonl-store.js`) | 不正な行番号とファイル名を明示し、安全のため書き込み・処理を中断。 |
| **書き込み失敗** | 保存キュー実行時 (`drainWrites`) | キューを停止し、「ファイルの保存に失敗しました。バックアップを取得してください」と警告。 |
| **ページ離脱** | `beforeunload` イベント | 書き込みキュー残存時にブラウザ警告を発動し、データ消失を防ぐ。 |
| **同一ファイル移動** | 分類操作時 (`move`) | ファイル書き込みを行わず、次レコードへのスキップ処理として扱う。 |
| **ジャンプ範囲外** | ジャンプ操作時 (`goTo`) | 自動クランプせず「1〜N の範囲で指定してください」と表示し、移動を拒否。 |
