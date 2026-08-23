# n8n-i18n-japanese リポジトリ向け Skills

本ファイルはこのリポジトリで作業する AI エージェント（Claude Code / GitHub Copilot / 各種コードエージェント）共通の知識ベースです。`CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md` からも参照されます。

人間の貢献者向けの一般情報は [`README.md`](../README.md) / [`docs/fork-differences.md`](../docs/fork-differences.md) / [`docs/claude-code-cli.md`](../docs/claude-code-cli.md) を参照してください。

---

## プロジェクト概要

- 目的: n8n の UI を日本語化し、`editor-ui-dist` および `n8n-ja` Docker イメージとして配布する。
- 上流: `n8nio/n8n`。バージョン追跡は [`.n8n-upstream-version`](../.n8n-upstream-version)。
- 主要成果物:
  - 翻訳ファイル [`languages/ja.json`](../languages/ja.json)
  - 翻訳済み `editor-ui.tar.gz`（GitHub Releases 配布）
  - `n8n-ja` Docker イメージ（Docker Hub、Claude Code CLI 同梱可）

## 翻訳フロー（決定論的 + LLM 分業）

1. n8n upstream の最新 `en.json` を取得。
2. ローカル前回コピー [`script/en.json`](../script/en.json) と **jq で差分抽出**（追加・変更キーのみ）。
3. 差分のみを LLM に翻訳依頼。
4. 翻訳結果を **jq で `languages/ja.json` にマージ**し、最新英語のキー順に再構築。
5. `script/en.json` を新しい英語ロケールで上書き。

ローカル実行は `script/translate.js`（[`package.json`](../package.json) の `i18n:translate`）から行います。`AI_PROVIDER` で `openai` / `gemini` を切替（GitHub Actions 上では Claude Code を利用）。

## ワークフロー構成（4 + 1）

| Workflow | 役割 |
|----------|------|
| [`n8n-monitor-pr.yml`](workflows/n8n-monitor-pr.yml) | n8n 新版を毎時検知 → 差分翻訳 → editor-ui ビルド → PR 作成 → オートマージ |
| [`pr-validate.yml`](workflows/pr-validate.yml) | PR の検証（YAML lint / JSON 妥当性 / n8n compose スモーク） |
| [`release-ja.yml`](workflows/release-ja.yml) | main 反映後に GitHub Release / Docker Hub / git tag 発行 |
| [`auto-heal.yml`](workflows/auto-heal.yml) | 上記が失敗したとき Claude が診断し修正 PR / issue を自動作成 |
| [`copilot-review-handler.yml`](workflows/copilot-review-handler.yml) | Jenkins 経由の Copilot レビュー結果（VERDICT）を起点にマージ / 自動修正ループ |

## 自動 PR の命名・ラベル規約

`copilot-review-handler` の eligibility gate と `auto-heal` の判定はここに依存します。

- **ブランチ命名**:
  - `auto-heal/*`（auto-heal ワークフローが起こす修正 PR）
  - `auto/n8n-*-ja`（n8n 更新監視ワークフローが起こす定期 PR）
- **対象ラベル**:
  - `auto-heal` — 自動診断・修復 PR
  - `automated` — 任意の自動 PR
  - `n8n-update` — n8n バージョン更新 PR
  - `needs-human-review` — 自動修正ループ上限到達。人手レビュー必須
  - `copilot-managed`（将来導入予定）— 任意 PR の Copilot レビュー対象化フラグ

## Copilot レビュー contract（Jenkins 投稿）

`copilot-review-handler.yml` が解釈する PR コメントの仕様。違反した形式は無視されます。

- 1 行目（または本文中）にマーカー: `## GitHub Copilot CLI レビュー (n8n-i18n-japanese 翻訳観点)`
- 末尾付近に **行頭完全一致** で: `VERDICT: APPROVE` または `VERDICT: REQUEST_CHANGES`
- 投稿者ログインは repository variable `JENKINS_BOT_USERNAME` と完全一致

上限: 同一 PR で Jenkins レビューコメントが 5 回到達した時点で `needs-human-review` ラベル付与 + 自動修正停止。

### auto-fix の「対応保留」返信

`auto-fix` job が指摘事項を機械修正しきれず PR に「対応保留」コメントを返す際:

- 投稿は `secrets.RELEASE_PAT`（アカウント: `YukiOno-1015`）名義で行われる。
  `JENKINS_BOT_USERNAME`（VERDICT 投稿元、アカウント: `jqit-yukiono`）とは別アカウント。
- コメント本文の末尾に必ず独立した行で `/jenkins-re-review` を付ける。
  Jenkins 側がこのコマンドを検知してレビューコメントを再取得する運用のため。

## Branch protection / ruleset

- main の ruleset ID: `16798607`
- 必須 status check 名（実 job 名と一致させる必要あり）:
  - `yaml-workflow-lint`
  - `format-check`
  - `n8n-smoke-test`
- `pull_request` ルール: `required_approving_review_count=0`（Copilot は approving review を出さないため）
- リポジトリ設定:
  - `allow_auto_merge=true`（必須。`gh pr merge --auto` の前提）
  - `delete_branch_on_merge=true`

## n8n-ja Docker イメージ

[`Dockerfile.n8n-ja`](../Dockerfile.n8n-ja) でビルド。

- `ARG INSTALL_CLAUDE_CODE=true` で Claude Code CLI を同梱（リリースビルドは true）。
- 認証は実行時 env で外だし: `ANTHROPIC_API_KEY` または `CLAUDE_CODE_OAUTH_TOKEN`。
- 認証 env がどちらも未設定だと `/usr/local/bin/claude` ラッパーが起動を拒否。

## コミット・PR 規約

- コミットメッセージは **プレフィックス付き日本語**:
  - `feat:` / `fix:` / `chore:` / `docs:` / `refactor:` / `test:` / `ci:` / `style:` / `perf:`
- main / master / Release ブランチには直接コミット禁止。作業ブランチを切る。
- プッシュ前にブランチの作業コミットは可能なら 1 つに squash。
- PR はテンプレートが無いため、Summary / Test plan を本文に明示する。
- AI が支援した PR は Co-Authored-By を末尾に追加（Claude Code が自動付与する場合あり）。

## 言語ポリシー

- 会話・コミットメッセージ・PR 本文: **日本語**
- コード内の識別子・コメント: **英語**（一般的な OSS 慣習に従う）
- Markdown 内の見出し: 日本語 OK

## やってはいけないこと

- `languages/**` / `script/en.json` を `auto-heal` 等の機械的修正対象に含めない。
- `main` への直接 push / `--no-verify` でのコミット / 自分発の PR を自分でマージ。
- リリースタグの再採番。`<n8n_version>-ja.N` の N は単調増加。
- イメージに Anthropic API キーや Docker Hub トークンを焼き込む。すべて実行時 env / Secrets。

## 関連ドキュメント

- [README](../README.md)
- [フォーク元との違い](../docs/fork-differences.md)
- [Claude Code CLI 同梱イメージ](../docs/claude-code-cli.md)
