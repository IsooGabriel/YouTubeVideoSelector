# 開発時の共通ルール

作業前に [Documents/MASTER_INSTRUCTIONS.md](Documents/MASTER_INSTRUCTIONS.md) を読むこと。この文書は短い運用上の要約であり、内容が競合する場合はマスター命令書を優先する。

## 最優先事項

- 個人の履歴データを外部へ送信・表示・Gitへ追加しない。報告にはタイトル、URL、チャンネル名、本文を含めず、件数・行番号・パターンIDだけを使う。
- `*.jsonl`、`channel_labels.json`、バックアップZIPは、依頼者の明示的な保存操作以外で変更しない。実データの検証はコピーに対して行う。
- 書込み、Undo、バックアップ、`jsonl-store.js` の挙動を、承認なしに変更しない。
- 新しい実行時依存、外部CDN、外部API、解析は追加しない。開発用依存の追加は事前に説明する。

## 開発手順

1. 日本語の仕様と受け入れ基準を確認・更新する。
2. 純粋ロジックはテストを先に作る。テスト名は日本語にする。
3. 最小限の実装を行い、全テストを実行する。
4. 同じ変更で仕様書、`docs/DATA_CONTRACT.md`、必要なら `Documents/PROJECT_FLOW.md` を更新する。

## 構造と依存

- UI → app（状態・操作）→ domain（純粋関数）の向きを守る。
- domain は DOM、`window`、ストレージ、ファイルAPI、状態を参照しない。
- UI は domain やファイルAPIを直接呼ばない。
- 外部形式のフィールド名は Adapter（現状は `src/record-fields.js`）だけが扱う。
- 新しい純粋モジュールは `src/domain/`、永続化は `src/infrastructure/` を基本にする。既存ファイルの移動は、テストで固定してから別作業で行う。

## コマンド

PowerShell で npm の実行ポリシーに阻まれる場合は `npm.cmd` を使う。

```powershell
npm.cmd run test
npm.cmd run build
node tools/inspect-data.js <実データをコピーしたフォルダ>
```

実データを渡す調査ツールの出力を共有する際は、個人情報を含めず、件数・行番号・フィールド名だけを共有する。
