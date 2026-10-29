# フォーク元との違い

本リポジトリ ([`jqit-yukiono/n8n-i18n-japanese`](https://github.com/jqit-yukiono/n8n-i18n-japanese)) は
フォーク元 ([`nemumusito/n8n-i18n-japanese`](https://github.com/nemumusito/n8n-i18n-japanese)、
大元は [`other-blowsnow/n8n-i18n-chinese`](https://github.com/other-blowsnow/n8n-i18n-chinese)) を
ベースに、**翻訳エンジンの刷新**と **CI/CD の完全自動化**を中心に大幅に拡張しています。

このドキュメントは「何が・なぜ違うのか」をまとめたものです。実装の詳細は各ファイルを参照してください。

---

## 概要（一覧）

| 領域 | フォーク元 | 本フォーク |
|------|-----------|-----------|
| 翻訳エンジン | Gemini API（`script/translate.js`、`gemini-pro`） | **Claude Code ベース**（GitHub Actions 上で差分翻訳） |
| 翻訳方式 | 全体をAPIへ投げて生成 | **jq で差分キーのみ抽出 → Claude が翻訳 → jq でマージ**（決定論的・低コスト） |
| 更新検知 | 手動／単一ワークフロー | n8n 新版を**毎時自動検知** |
| リリース | `editor-ui` パッケージ化のみ | **GitHub Release + Docker Hub イメージ + git tag を自動発行** |
| 自動化 | なし | 検知→翻訳→PR→**自動マージ**→リリースまで無人 |
| 失敗対応 | なし | **auto-heal**：失敗時に Claude が診断し修正PR/issueを自動作成 |
| 配布イメージ | なし（compose で素の n8n + マウント） | **`n8n-ja` イメージ**（日本語化済み、Claude Code CLI 同梱可） |
| バージョン追跡 | なし | `.n8n-upstream-version` で追跡 |

---

## 1. 翻訳エンジンの刷新

- **フォーク元**: `script/translate.js` が Gemini API（`GEMINI_API_KEY` / `gemini-pro`）を直接呼び、
  ローカル実行で翻訳していた。
- **本フォーク**: GitHub Actions 上で **Claude Code** により翻訳する方式へ移行
  （[#22](https://github.com/jqit-yukiono/n8n-i18n-japanese/pull/22)）。さらに翻訳処理を再設計し
  （[#25](https://github.com/jqit-yukiono/n8n-i18n-japanese/pull/25)）、ソート・全文書き換えなどの
  決定論的処理は **jq** が担当、Claude は**差分キーの翻訳のみ**を行う構成にした。
  - 旧英語ロケールと新英語ロケールを jq で比較し、追加・変更キーだけを抽出
  - Claude がその差分のみを翻訳（巨大ファイル全体を扱わないため高速・低コスト・安定）
  - jq で最新英語のキー順に `languages/ja.json` を再構築し、`script/en.json` を同期

> 関連: [`.github/workflows/n8n-monitor-pr.yml`](../.github/workflows/n8n-monitor-pr.yml)

## 2. CI/CD の完全自動化

フォーク元の単一ワークフロー（`editor-ui` のパッケージ化）を廃し、5 つのワークフローに再編した。

| ワークフロー | 役割 |
|-------------|------|
| [`n8n-monitor-pr.yml`](../.github/workflows/n8n-monitor-pr.yml) | n8n 新版を毎時検知 → 差分翻訳 → editor-ui パッチ適用/自動修復 → ビルド → PR 作成 → 自動マージ |
| [`pr-validate.yml`](../.github/workflows/pr-validate.yml) | PR の検証（フォーマット / lint / スモーク） |
| [`copilot-review-handler.yml`](../.github/workflows/copilot-review-handler.yml) | Jenkins 経由の Copilot レビュー結果（VERDICT）を起点にマージ / 自動修正ループ |
| [`release-ja.yml`](../.github/workflows/release-ja.yml) | main 反映後に GitHub Release / Docker Hub イメージ / git tag を発行 |
| [`auto-heal.yml`](../.github/workflows/auto-heal.yml) | 上記が失敗したとき Claude が失敗ログを診断し、修正PR（要レビュー）または issue を自動作成 |

主な堅牢化（[#29](https://github.com/jqit-yukiono/n8n-i18n-japanese/pull/29)）:

- 自動 PR を `RELEASE_PAT` で作成し、マージ後のリリースを自動連鎖
- リリースは locale/version 関連の変更時のみ発火（path フィルタ）＋重複ガード
- `concurrency` による重複起動防止、ジョブ/ステップ `timeout`

## 3. 配布イメージの追加

- **フォーク元**: 配布イメージは無く、`docker-compose` で素の `n8nio/n8n` に `editor-ui-dist` を
  マウントする方式のみ。
- **本フォーク**: 日本語化済みの **`n8n-ja` イメージ**を `Dockerfile.n8n-ja` でビルドし、Docker Hub に公開。
  - リリース資産の `editor-ui.tar.gz` を取り込み、`N8N_DEFAULT_LOCALE=ja` を既定化
  - **Claude Code CLI を任意で同梱**でき、n8n ワークフローから `claude` を呼べる
    （認証は実行時 env で外だし、未設定なら起動拒否）。詳細は
    [Claude Code CLI 同梱イメージ](./claude-code-cli.md) を参照。

## 4. その他

- `.n8n-upstream-version`：追従中の n8n バージョンを明示的に追跡。
- `script/update-editor-ui-patch.sh`：上流構成変更に追従して editor-ui パッチを自動更新。
- `script/translate-google.js`：補助的な翻訳スクリプト。
- README を GitHub Releases 主体の導線に刷新。

---

## 補足

- フォーク元との分岐点（merge-base）はフォーク元 `main` の `e2d5539` です。
  以降の差分が本フォーク独自の変更にあたります。
- 翻訳データ（`languages/ja.json` / `script/en.json`）は対応 n8n バージョンに合わせて全面的に更新されています。

<!-- Jenkins Pod agent レビュー動作確認用（使い捨て。マージしない） -->
