# GitHub Copilot 向け プロジェクト指示

このファイルは GitHub Copilot およびこのリポジトリに対して Copilot CLI / Copilot Code Review が読み取るプロジェクト指示です。

詳細は [`.github/Skills.md`](Skills.md) を参照してください（正規ソース）。

## このリポジトリは何か

n8n の UI を日本語化し、翻訳済み `editor-ui` と `n8n-ja` Docker イメージとして配布するプロジェクトです。

## レビュー観点

Copilot がこのリポジトリの PR をレビューする際は、以下を重点的に見てください。

### 翻訳品質

- 訳語ゆれ（例: 「サーバ」と「サーバー」の混在）。本プロジェクトでは既存 `languages/ja.json` の表記に合わせること。
- 固有名詞（n8n / Workflow / Trigger / Node / Webhook 等）はカタカナ化せず原文表記を尊重する。
- 敬体／常体の混在を避ける（n8n UI は基本敬体）。
- プレースホルダー `{{ }}` や `%s` などのフォーマット記号を翻訳せず原文ままにすること。

### CI/CD ワークフロー

- `.github/workflows/` 配下の YAML 変更時は、以下に注意する。
  - 必須 status check 名（`yaml-workflow-lint` / `format-check` / `n8n-smoke-test`）と一致するジョブ名を維持する。
  - 自動 PR の eligibility gate に使われるブランチ命名（`auto-heal/*` / `auto/n8n-*-ja`）とラベル（`auto-heal` / `automated` / `n8n-update`）を破壊しない。
  - `gh pr merge` を呼ぶ場所では `--auto` フラグを保つ（Branch protection 対応）。

### セキュリティ

- Anthropic API キー / Docker Hub トークン / OAuth トークン等をハードコードしていないか。
- Docker イメージビルド時に認証情報を焼き込んでいないか（`Dockerfile.n8n-ja` は実行時 env での認証が前提）。
- シェルコマンドで PR 由来の文字列を直接補間してインジェクションリスクを生んでいないか。

## レビューコメントの出力形式（contract）

`copilot-review-handler.yml` ワークフローはこの形式の PR コメントを解釈してマージ／自動修正を駆動します。**変更しないでください**。

```text
## GitHub Copilot CLI レビュー (n8n-i18n-japanese 翻訳観点)

**リポジトリ**: `jqit-yukiono/n8n-i18n-japanese`
**PR**: [#<番号> — <タイトル>](<URL>)
**ブランチ**: `<branch>` / SHA: `<sha>`

---

## レビュー結果

### 対象
（対象ファイル一覧）

---

### 指摘事項
（指摘事項を箇条書き）

---

VERDICT: <APPROVE|REQUEST_CHANGES>
```

- マーカー: `## GitHub Copilot CLI レビュー (n8n-i18n-japanese 翻訳観点)` を**必ず**含める。
- 最終行付近に **行頭完全一致** で `VERDICT: APPROVE` または `VERDICT: REQUEST_CHANGES` を出す。`<APPROVE|REQUEST_CHANGES>` のプレースホルダーは実際の判定値に置換すること。
- どちらの判定でも本文には具体的な指摘事項を箇条書きで書く（`REQUEST_CHANGES` のときは `claude-code-action` がこれを読んで自動修正を試みる）。

例:

```text
（…レビュー本文…）

VERDICT: APPROVE
```

```text
（…レビュー本文：要修正点を箇条書きで明示…）

VERDICT: REQUEST_CHANGES
```

## やってはいけないこと

- `languages/ja.json` の機械的な書き換えを Copilot レビュー自身が行わない（翻訳フロー専用）。
- `main` への直接 push を含む差分を承認しない。
- 認証情報の焼き込みを承認しない。
