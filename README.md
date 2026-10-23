# n8n 日本語化プロジェクト

このプロジェクトは、n8n のユーザーインターフェース (UI) を日本語で利用可能にすることを目的としています。

**多くのユーザーにとって最も簡単な方法は、GitHub Releases からビルド済みの日本語化パッケージをダウンロードすることです。**

[**最新の日本語化パッケージはこちらからダウンロード (GitHub Releases)**](https://github.com/jqit-yukiono/n8n-i18n-japanese/releases)

このリリースには、特定の n8n バージョンに対応した翻訳済み `editor-ui` が `editor-ui.tar.gz` として含まれています。
これを利用することで、煩雑なビルド作業なしに n8n を日本語で利用開始できます。

## ドキュメント

- [フォーク元との違い](docs/fork-differences.md) — 本フォークがフォーク元から加えた主な変更（翻訳エンジン刷新・CI/CD 完全自動化・配布イメージ等）
- [Claude Code CLI 同梱イメージ](docs/claude-code-cli.md) — `n8n-ja` イメージへの Claude Code CLI 同梱と、n8n ワークフローからの利用方法

## 主な機能

- **翻訳済み `editor-ui` の配布 (推奨)**: 最新の n8n リリースに対応した、日本語化済みの `editor-ui` ビルド成果物を [GitHub Releases](https://github.com/jqit-yukiono/n8n-i18n-japanese/releases) で公開しています。
- **日本語翻訳ファイルの提供**: n8n の UI テキストに対応する日本語の翻訳ファイル ([`languages/ja.json`](languages/ja.json:0)) を提供します。これは主に開発者や、自身でビルドを行いたい方向けです。
- **Docker イメージでの簡易利用**: `docker-compose` を使用して、日本語化された n8n 環境を簡単に起動できます。

## 利用方法

### 1. GitHub Releases からパッケージを取得して利用する (推奨)

1. **パッケージのダウンロード**:
    [GitHub Releases ページ](https://github.com/jqit-yukiono/n8n-i18n-japanese/releases) から、利用したい n8n のバージョンに対応する `editor-ui.tar.gz` をダウンロードします。
2. **パッケージの展開**:
    ダウンロードした `editor-ui.tar.gz` を展開し、`editor-ui-dist` ディレクトリを取得します。
3. **Docker で n8n を起動**:
    以下のいずれかの方法で Docker を利用して n8n を起動します。
    - **`docker-compose.yml` を利用する場合 (簡単):**
      1. このリポジトリをクローンまたはダウンロードします。

          ```shell
          git clone https://github.com/jqit-yukiono/n8n-i18n-japanese.git # またはあなたのフォーク
          cd n8n-i18n-japanese
          ```

      2. 取得した `editor-ui-dist` ディレクトリを、クローンしたリポジトリのルート (`docker-compose.yml` と同じ階層) に配置します。
      3. `docker-compose.yml` 内の `image: n8nio/n8n:{version}` の `{version}` を、ダウンロードしたパッケージが対応する n8n のバージョンに合わせてください (例: `n8nio/n8n:1.23.0`)。
      4. Docker Compose を起動します。

          ```shell
          docker-compose up
          ```

          これにより、配置した `editor-ui-dist` がコンテナにマウントされ、n8n が日本語 UI で起動します。

    - **`docker run` コマンドを利用する場合:**

      ```shell
      # 【】内はご自身の環境に合わせて変更してください
      docker run -it --rm --name n8n-japanese-test \
      -p 15678:5678 \
      -v 【ローカルの editor-ui-dist ディレクトリのパス】:/usr/local/lib/node_modules/n8n/node_modules/n8n-editor-ui/dist \
      -e N8N_DEFAULT_LOCALE=ja \
      -e N8N_SECURE_COOKIE=false \
      n8nio/n8n:【n8nのバージョン】
      ```

      【n8nのバージョン】には、ダウンロードしたパッケージが対応するバージョンを指定してください。

### 2. 手動で翻訳とビルドを行う場合 (開発者向け・補助手段)

> **注意**: 本番の翻訳フローは GitHub Actions 上の Claude Code による差分翻訳（[フォーク元との違い](docs/fork-differences.md) 参照）です。以下は `script/translate.js`（Gemini / OpenAI API 利用）によるローカル検証用の補助手段で、本番フローとは別経路です。

最新の翻訳を自分で生成したり、開発目的で利用したりする場合は、以下の手順で手動実行できます。

1. **環境変数の設定**:
    - n8n のデフォルト言語を日本語に設定します。プロジェクトルートに `.env` ファイルを作成し、以下を記述するか、環境変数として設定してください。

      ```dotenv
      N8N_DEFAULT_LOCALE=ja
      ```

    - 翻訳スクリプトは Gemini API を利用します。プロジェクトルートに `.env` ファイルを作成 (または `.env.example` をコピーして編集) し、以下の環境変数を設定してください。

      ```dotenv
      # Gemini API Key (必須)
      GEMINI_API_KEY="YOUR_GEMINI_API_KEY_HERE"

      # Gemini Model (任意、デフォルト: gemini-pro)
      # AIプロバイダ (openai / gemini)
      AI_PROVIDER="openai"

      # OpenAI API Key (openai利用時は必須)
      OPENAI_API_KEY="YOUR_OPENAI_API_KEY_HERE"

      # OpenAI モデル (任意)
      OPENAI_MODEL="gpt-4o-mini"

      # Gemini API Key (gemini利用時は必須)
      GEMINI_API_KEY="YOUR_GEMINI_API_KEY_HERE"

      # Gemini モデル (任意)
      # 例: GEMINI_MODEL="gemini-1.5-flash"
      GEMINI_MODEL="gemini-1.5-flash"

      # 翻訳プロンプト (任意、未設定の場合はスクリプト内のデフォルトプロンプトを使用)
      # LLMに翻訳方法を指示するプロンプトです。
      # カスタマイズする場合は、スクリプトが期待するプレースホルダー (${language}, ${uniqueSeparator}, ${textsToTranslate}) を含める必要があります。
      # 詳細は .env.example ファイルおよび script/translate.js 内のデフォルトプロンプトを参照してください。
      # TRANSLATION_PROMPT="ここにカスタムプロンプトを記述..."
      #
      # 翻訳対象言語 (任意、未設定の場合は日本語のみを対象とします)
      # JSON形式の文字列で、オブジェクトの配列として指定します。
      # 各オブジェクトは "name" (言語コード) と "label" (言語名) を持つ必要があります。
      # 例: TARGET_LANGUAGES='[{"name":"ja","label":"日本語"},{"name":"en","label":"English"}]'
      # TARGET_LANGUAGES='[{"name":"ja","label":"日本語"}]'
      ```

2. **依存関係のインストール**:

    ```shell
    npm install
    ```

3. **翻訳スクリプトの実行**:
    以下のコマンドで、最新の英語ロケールファイルを取得し、日本語に翻訳して [`languages/ja.json`](languages/ja.json:0) を更新します。

    ```shell
    npm run i18n:translate
    ```

    このスクリプトは、[`script/en.json`](script/en.json:0) (前回取得した英語ロケール) と比較し、差分のみを翻訳します。
4. **ビルド済み `editor-ui` の配置**:
    上記スクリプトは翻訳ファイルを作成するのみです。n8n 本体に日本語 UI を適用するには、n8n のソースコードを取得し、`languages/ja.json` を配置した上で `editor-ui` パッケージをビルドし、生成された `dist` ディレクトリを n8n のインストール先に配置する必要があります。
    このリポジトリの GitHub Actions では、このビルドプロセスを自動化し、`editor-ui-dist` ディレクトリを生成して GitHub Releases に公開しています。

### 3. Docker で翻訳スクリプトを実行する

このリポジトリには、翻訳スクリプト実行用の `Dockerfile` が含まれています。
ベースイメージは `node:22-alpine` (Node.js 22 系) を利用しています。

1. **`.env` を準備する**:
    プロジェクトルートの `.env` に `AI_PROVIDER` と対応するAPIキー (`OPENAI_API_KEY` または `GEMINI_API_KEY`) を設定してください。
2. **Docker イメージをビルドする**:

    ```shell
    docker build -t n8n-i18n-japanese-translator .
    ```

3. **翻訳スクリプトを実行する**:

    ```shell
    docker run --rm \
      --env-file .env \
      -v $(pwd)/languages:/app/languages \
      -v $(pwd)/script:/app/script \
      n8n-i18n-japanese-translator
    ```

この実行により、`languages/*.json` と `script/en.json` の更新結果がホスト側に反映されます。

`docker-compose.yml` を使う場合は、以下でも実行できます。

```shell
docker compose build translator
docker compose run --rm translator
```

補足: `docker compose` はプロジェクトルートの `.env` を読み込みます。`.env` の値は基本的に1行で記述し、複数行テキスト（改行を含む `TRANSLATION_PROMPT` など）はそのまま書かないようにしてください。

## 翻訳の仕組み (ローカル手動フロー)

上記 2./3. の手動フローの仕組みです。GitHub Actions 上の本番フローは [フォーク元との違い](docs/fork-differences.md) を参照してください（決定論的な差分抽出は共通ですが、翻訳自体は Claude Code が行います）。

1. **英語ロケールファイルの取得**: n8n の公式リポジトリから最新の英語ロケールファイル (`en.json`) を取得します。
2. **差分翻訳**: ローカルに保存されている前回の英語ロケールファイル ([`script/en.json`](script/en.json:0)) と比較し、新規追加または変更されたテキストのみを抽出します。
3. **自動翻訳**: 抽出されたテキストを、[`script/translate.js`](script/translate.js:0) スクリプトが OpenAI または Gemini API を利用して日本語に翻訳します。
4. **翻訳ファイルの保存**: 翻訳結果を既存の日本語翻訳ファイル ([`languages/ja.json`](languages/ja.json:0)) にマージ・更新します。
5. **UI への適用**: 更新された `ja.json` を含む `editor-ui` パッケージをビルドし、n8n 環境に配置します。環境変数 `N8N_DEFAULT_LOCALE=ja` を設定することで、n8n の UI が日本語で表示されます。

## GitHub Actions による自動化

このリポジトリでは、5 つの GitHub Actions ワークフローで、監視からリリース、レビュー駆動の自動修正までを自動化しています。詳細は [.github/Skills.md](.github/Skills.md) を参照してください。

- **監視と更新PR作成**: [.github/workflows/n8n-monitor-pr.yml](.github/workflows/n8n-monitor-pr.yml)
  - n8n 最新リリースを毎時監視
  - 新バージョン検知時に Claude Code で差分翻訳 → `editor-ui-dist` を再生成
  - `docker-compose.yml` の n8n バージョン更新
  - 自動で更新PRを作成し、オートマージを有効化

- **PR検証**: [.github/workflows/pr-validate.yml](.github/workflows/pr-validate.yml)
  - JSON/基本フォーマットチェック
  - 翻訳スクリプト構文チェック
  - `docker compose` で n8n を起動してスモークテスト

- **Copilot レビュー駆動のマージ/自動修正**: [.github/workflows/copilot-review-handler.yml](.github/workflows/copilot-review-handler.yml)
  - Jenkins 経由で投稿される GitHub Copilot レビュー結果 (VERDICT) を起点に動作
  - `VERDICT: APPROVE` → squash マージ
  - `VERDICT: REQUEST_CHANGES` → Claude Code が指摘事項を機械修正してプッシュ（上限到達で `needs-human-review` ラベル）

- **mainマージ後リリース**: [.github/workflows/release-ja.yml](.github/workflows/release-ja.yml)
  - n8n-ja Dockerイメージをビルドして Docker Hub へ push
  - タグを自動採番して作成 (例: `2.43.7-ja.1`)
  - GitHub Release を作成し、`languages/ja.json` と `editor-ui.tar.gz` を添付

- **失敗時の自動診断・修復**: [.github/workflows/auto-heal.yml](.github/workflows/auto-heal.yml)
  - 上記ワークフローが失敗したとき Claude Code が失敗ログを診断
  - 機械的に修正可能なら修正PRを作成（ラベル `auto-heal`、マージは人手）
  - 外部要因（上流障害・レート制限等）なら issue を作成

### 必要な Secrets / Variables

| 種別 | 名前 | 用途 |
|------|------|------|
| Secret | `RELEASE_PAT` | 自動PRの作成・push、`claude-code-action` の GitHub 操作（repo write 権限が必要） |
| Secret | `CLAUDE_CODE_OAUTH_TOKEN` | `claude-code-action`（差分翻訳・自動修正・auto-heal診断）の認証 |
| Secret | `DOCKERHUB_USERNAME` | Docker Hub へのログイン（n8n-ja イメージ push） |
| Secret | `DOCKERHUB_TOKEN` | 同上（**Read & Write** 権限の Personal Access Token が必要） |
| Secret | `SLACK_WEBHOOK_URL` | 失敗時・自動修正ループ上限到達時の Slack 通知（任意） |
| Variable | `JENKINS_BOT_USERNAME` | Jenkins が投稿する Copilot レビューコメントの投稿者ログイン（eligibility gate 判定に使用） |

### Secrets の設定方法 (Docker Hub の例)

1. Docker Hub でアクセストークンを作成

- Docker Hub にログイン
- **Account Settings** → **Personal access tokens** → **Generate new token**
- Permissions を **Read, Write** にして作成し、表示されたトークン文字列を控える（発行後は権限変更できないため、Read-only で作ってしまった場合は再発行する）

1. GitHub リポジトリに Secrets を登録

- 対象リポジトリを開く
- **Settings** → **Secrets and variables** → **Actions**
- **New repository secret** から上記の表の Secret を登録する

1. 動作確認

- `main` への push で `mainマージ後リリース` ワークフローが実行される
- `Log in to Docker Hub` ステップが成功すれば Secrets 設定は正常

1. 運用上の推奨

- トークンは定期ローテーションする
- 不要になったトークンは Docker Hub 側で失効させる
- Organization 管理の場合は、必要に応じて Organization Secrets を使用する

### 補足

- n8n-ja イメージは [Dockerfile.n8n-ja](Dockerfile.n8n-ja) を使って作成します。
- タグ採番は、同一 n8n バージョンに対して `-ja.N` をインクリメントします。
- ワークフロー構成・Copilot レビューの contract・ブランチ命名規約の詳細は [.github/Skills.md](.github/Skills.md) を参照してください。

## コントリビューション

翻訳の改善や、他の言語パックの追加、機能改善に関するプルリクエストを歓迎します。

- **他の言語パックの追加**:
  1. [`languages/`](languages/) ディレクトリに `{言語コード}.json` (例: `ko.json`) の形式でファイルを作成します。
  2. [`script/translate.js`](script/translate.js:0) の `targetLanguages` 配列に新しい言語の情報を追加します。
  3. プルリクエストを送信してください。可能であれば、翻訳スクリプトが新しい言語に対応できるように修正を加えてください。
- **不具合報告・改善提案**: Issues にてご報告ください。
