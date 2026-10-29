require('dotenv').config()
const fs = require('node:fs');
const path = require('node:path'); // path モジュールをインポート
const crypto = require('node:crypto');

// AI provider settings from environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const AI_PROVIDER = (process.env.AI_PROVIDER || (OPENAI_API_KEY ? 'openai' : 'gemini')).toLowerCase();
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const API_MAX_RETRIES_429 = Number(process.env.API_MAX_RETRIES_429 || process.env.GEMINI_MAX_RETRIES_429 || '6');
const API_MIN_RETRY_MS = Number(process.env.API_MIN_RETRY_MS || process.env.GEMINI_MIN_RETRY_MS || '8000');

// プロセス終了を伴うため、実際に CLI として起動されたときだけ呼び出す（require.main 配下）。
function validateProviderConfig() {
    if (AI_PROVIDER === 'openai' && !OPENAI_API_KEY) {
        console.error('環境変数 OPENAI_API_KEY を設定してください。');
        process.exit(1);
    }

    if (AI_PROVIDER === 'gemini' && !GEMINI_API_KEY) {
        console.error('環境変数 GEMINI_API_KEY を設定してください。');
        process.exit(1);
    }

    if (!['openai', 'gemini'].includes(AI_PROVIDER)) {
        console.error(`未対応のAIプロバイダです: ${AI_PROVIDER} (openai または gemini を指定してください)`);
        process.exit(1);
    }
}

const defaultTargetLanguages = [
    {
        "name": "ja", // Or "ja-JP" if you prefer
        "label": "日本語",
    }
];

function resolveTargetLanguages() {
    if (!process.env.TARGET_LANGUAGES) {
        console.log("環境変数 TARGET_LANGUAGES が未設定です。デフォルトの翻訳対象言語（日本語）を使用します。");
        return defaultTargetLanguages;
    }

    try {
        const parsedLanguages = JSON.parse(process.env.TARGET_LANGUAGES);
        if (Array.isArray(parsedLanguages) && parsedLanguages.every(lang => lang && typeof lang.name === 'string' && typeof lang.label === 'string')) {
            console.log("環境変数 TARGET_LANGUAGES から翻訳対象言語を読み込みました:", parsedLanguages.map(l => l.label).join(', '));
            return parsedLanguages;
        }
        console.warn("環境変数 TARGET_LANGUAGES の形式が正しくありません。デフォルトの翻訳対象言語（日本語）を使用します。");
        return defaultTargetLanguages;
    } catch (e) {
        console.error("環境変数 TARGET_LANGUAGES のJSONパースに失敗しました。デフォルトの翻訳対象言語（日本語）を使用します。", e);
        return defaultTargetLanguages;
    }
}

// 翻訳結果を分割するための区切り文字（API呼び出しごとにユニークにする）
function generateUniqueSeparator() {
    return `__TRANSLATION_ITEM_SEPARATOR_${Date.now()}__${crypto.randomUUID()}__`;
}

function parseApiErrorText(errorText) {
    try {
        return JSON.parse(errorText);
    } catch {
        return errorText;
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractRetryDelayMs(errorData) {
    const message = typeof errorData === 'string'
        ? errorData
        : errorData?.error?.message || '';
    const retryRegex = /Please retry in\s+([0-9.]+)s\.?/i;
    const match = retryRegex.exec(String(message));
    if (!match) {
        return API_MIN_RETRY_MS;
    }

    const sec = Number(match[1]);
    if (!Number.isFinite(sec) || sec <= 0) {
        return API_MIN_RETRY_MS;
    }

    // 少し余裕を持たせる
    return Math.max(API_MIN_RETRY_MS, Math.ceil(sec * 1000) + 1000);
}

function buildOpenAIRequestBody(prompt) {
    return JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        messages: [
            {
                role: 'system',
                content: 'You are a translation engine. Return only translated text.',
            },
            {
                role: 'user',
                content: prompt,
            },
        ],
    });
}

function buildGeminiRequestBody(prompt) {
    return JSON.stringify({
        contents: [{
            parts: [{
                text: prompt,
            }],
        }],
    });
}

async function postGemini(endpoint, prompt) {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: buildGeminiRequestBody(prompt),
    });

    if (response.ok) {
        return { ok: true, data: await response.json() };
    }

    const errorText = await response.text();
    const errorData = parseApiErrorText(errorText);
    return {
        ok: false,
        status: response.status,
        errorData,
    };
}

async function postOpenAI(endpoint, prompt) {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: buildOpenAIRequestBody(prompt),
    });

    if (response.ok) {
        return { ok: true, data: await response.json() };
    }

    const errorText = await response.text();
    const errorData = parseApiErrorText(errorText);
    return {
        ok: false,
        status: response.status,
        errorData,
    };
}

async function requestWithRetries(endpoint, model, prompt, itemCount, postFn, providerLabel, treat404AsUnsupportedModel) {
    let retryCount = 0;
    let lastError = null;

    // retryCount は 429 時のみ increment し、その直前に
    // retryCount < API_MAX_RETRIES_429 を確認しているため、ループは必ず
    // 内側の return/throw で終わる(while条件が false になって抜けることはない)。
    while (true) {
        const result = await postFn(endpoint, prompt);
        if (result.ok) {
            return { ok: true, data: result.data };
        }

        lastError = { status: result.status, errorData: result.errorData, model };

        if (result.status === 404 && treat404AsUnsupportedModel) {
            return { ok: false, unsupportedModel: true, lastError };
        }

        if (result.status === 429 && retryCount < API_MAX_RETRIES_429) {
            const waitMs = extractRetryDelayMs(result.errorData);
            const waitSec = Math.ceil(waitMs / 1000);
            console.warn(`${providerLabel} API 429: ${waitSec}秒待機して再試行します (${retryCount + 1}/${API_MAX_RETRIES_429}) model=${model}`);
            retryCount++;
            await sleep(waitMs);
            continue;
        }

        console.error(`${providerLabel} API Error:`, result.errorData);
        throw new Error(`${providerLabel} API request failed with status ${result.status} for a batch of ${itemCount} items.`);
    }
}

function buildGeminiModelCandidates(configuredModel) {
    const previewFallbacks = configuredModel.startsWith('gemini-2.5-flash-preview')
        ? ['gemini-2.5-flash']
        : [];
    const candidates = [
        configuredModel,
        ...previewFallbacks,
        'gemini-2.0-flash',
        'gemini-1.5-flash',
    ];

    return [...new Set(candidates.filter(Boolean))];
}

async function requestGeminiWithFallback(prompt, itemCount) {
    const apiVersions = ['v1beta', 'v1'];
    const modelCandidates = buildGeminiModelCandidates(GEMINI_MODEL);
    let lastError = null;

    for (const model of modelCandidates) {
        for (const version of apiVersions) {
            const endpoint = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

            const result = await requestWithRetries(endpoint, model, prompt, itemCount, postGemini, 'Gemini', true);
            if (result.ok) {
                if (model !== GEMINI_MODEL || version !== 'v1beta') {
                    console.warn(`Gemini設定をフォールバックしました: model=${model}, apiVersion=${version}`);
                }
                return result.data;
            }

            // treat404AsUnsupportedModel=true で呼んでいるため、ここに来る
            // result は常に unsupportedModel:true（404）。他の失敗は
            // requestWithRetries 内で throw されるので、次の apiVersion/model を
            // 試し続けるだけでよい。
            lastError = {
                ...result.lastError,
                version,
            };
        }
    }

    console.error('Gemini API Error:', lastError ? lastError.errorData : 'unknown');
    throw new Error(`Gemini API request failed with status ${lastError ? lastError.status : 'unknown'} for a batch of ${itemCount} items.`);
}

async function requestOpenAI(prompt, itemCount) {
    const endpoint = 'https://api.openai.com/v1/chat/completions';
    // treat404AsUnsupportedModel=false で呼んでいるため、requestWithRetries は
    // 成功時以外は必ず throw する（エラーログ・例外メッセージも内部で済ませている）。
    const result = await requestWithRetries(endpoint, OPENAI_MODEL, prompt, itemCount, postOpenAI, 'OpenAI', false);
    return result.data;
}

function extractCombinedTranslations(data) {
    if (AI_PROVIDER === 'openai') {
        const text = data?.choices?.[0]?.message?.content;
        if (typeof text === 'string' && text.trim().length > 0) {
            return text.trim();
        }
        console.error('OpenAI translation response is empty or malformed:', data);
        throw new Error('OpenAIレスポンスから翻訳テキストを抽出できませんでした。');
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text === 'string' && text.trim().length > 0) {
        return text.trim();
    }
    console.error('バッチ翻訳に対する予期しないGemini APIレスポンス構造:', data);
    throw new Error('Gemini APIレスポンスから翻訳を抽出できませんでした。');
}

async function fetchJsonWithFallback(urls) {
    let lastError = null;

    for (const url of urls) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const text = await response.text();
            try {
                return JSON.parse(text);
            } catch (parseError) {
                throw new Error(`JSON parse error: ${parseError.message}`);
            }
        } catch (e) {
            lastError = `${url} -> ${e.message}`;
            console.warn(`英語ロケール取得失敗: ${lastError}`);
        }
    }

    throw new Error(lastError || 'all locale fetch attempts failed');
}

async function doTranslate(messagesToTranslate, language) { // messagesToTranslate は文字列の配列
    if (!messagesToTranslate || messagesToTranslate.length === 0) {
        return [];
    }

    const uniqueSeparator = generateUniqueSeparator();
    // 各メッセージに番号を付け、区切り文字で結合
    const textsToTranslate = messagesToTranslate.map((msg, index) => `ITEM_START [${index + 1}] ${msg} ITEM_END`).join(`\n${uniqueSeparator}\n`);

    const defaultPromptTemplate = `あなたは高度な翻訳APIです。以下の複数の英語のテキストを、それぞれ忠実に ${language} に翻訳してください。
各英語テキストは「ITEM_START [番号]」で始まり「ITEM_END」で終わります。そして、各英語テキスト間は「${uniqueSeparator}」という特殊な文字列で区切られています。

あなたのタスクは、各英語テキストを ${language} に翻訳し、翻訳結果のみを返すことです。
翻訳結果も、必ず原文の順番通りに、「${uniqueSeparator}」という全く同じ文字列で区切って返してください。
「ITEM_START [番号]」や「ITEM_END」といったマーカーは翻訳結果に含めないでください。
挨拶、説明、前置き、後書き、その他の追加情報は一切含めず、翻訳されたテキスト群だけを「${uniqueSeparator}」で区切って出力してください。

英語テキスト群:
${textsToTranslate}

${language}への翻訳結果群 (各翻訳を「${uniqueSeparator}」で区切ってください):`;

    const userPromptTemplate = process.env.TRANSLATION_PROMPT;
    let prompt;

    if (userPromptTemplate) {
        prompt = userPromptTemplate
            .replaceAll('${language}', language)
            .replaceAll('${uniqueSeparator}', uniqueSeparator)
            .replaceAll('${textsToTranslate}', textsToTranslate);
    } else {
        prompt = defaultPromptTemplate;
    }

    const data = AI_PROVIDER === 'openai'
        ? await requestOpenAI(prompt, messagesToTranslate.length)
        : await requestGeminiWithFallback(prompt, messagesToTranslate.length);

    try {
        const combinedTranslations = extractCombinedTranslations(data);
        
        let translatedTexts = combinedTranslations.split(uniqueSeparator).map(t => t.trim());

        // 後処理用のパターン定義
        const patternsToRemove = [
            /^(承知しました|はい、分かりました|了解しました|かしこまりました)[、。]?.*?翻訳します[：。\s]*/is,
            /^(承知しました|はい、分かりました|了解しました|かしこまりました)[、。]?.*?翻訳結果です[：。\s]*/is,
            /^(承知しました|はい、分かりました|了解しました|かしこまりました)[、。]?\s*/i,
            /^.*?翻訳結果は以下の通りです[：。\s]*/is,
            /^.*?翻訳は以下の通りです[：。\s]*/is,
            /^.*?翻訳しました[：。\s]*/is,
            /^以下に翻訳します[：。\s]*/i,
            /^翻訳結果[：。\s]*/i,
            /^(Okay|Sure|Alright|Understood|Got it),?\s*here's the translation:?\s*/i,
            /^(Okay|Sure|Alright|Understood|Got it),?\s*I will translate that for you:?\s*/i,
            /^(Okay|Sure|Alright|Understood|Got it),?\s*/i,
            /^ITEM_START\s*\[\d+\]\s*/i, // ITEM_START [番号] が残っていたら削除
            /\s{0,200}ITEM_END\s*$/i,  // ITEM_END が残っていたら削除
            /^\[\d+\]\s*/,             // [番号] のみが残っていたら削除
        ];
        
        const cleanText = (text) => {
            let cleanedText = text;
            for (const pattern of patternsToRemove) {
                cleanedText = cleanedText.replace(pattern, '');
            }
            cleanedText = cleanedText.replace(/^["「『]/, '').replace(/["」『]$/, ''); // 引用符削除
            return cleanedText.trim();
        };

        if (translatedTexts.length !== messagesToTranslate.length) {
            console.warn(`警告: 分割後の翻訳アイテム数(${translatedTexts.length})が原文アイテム数(${messagesToTranslate.length})と一致しません。APIレスポンス: "${combinedTranslations.substring(0, 500)}..."`); // レスポンスが長い場合があるので一部表示

            // 翻訳結果数が原文数より極端に多い場合（区切り文字が機能しなかった可能性が高い）
            if (translatedTexts.length > messagesToTranslate.length * 2 && messagesToTranslate.length > 1) {
                 console.error(`エラー: 翻訳結果の分割数が原文アイテム数に対して著しく多い(${translatedTexts.length} vs ${messagesToTranslate.length})。APIが区切り文字を正しく解釈しなかった可能性が高いです。このチャンクの翻訳は信頼性が低いため、空として扱います。`);
                 return new Array(messagesToTranslate.length).fill(''); // 全て空文字で返す
            }
            
            // それ以外の場合（多少のズレ）、原文の数に合わせる
            const adjustedTranslations = new Array(messagesToTranslate.length).fill('');
            for(let i=0; i < messagesToTranslate.length; i++) {
                if (translatedTexts[i] !== undefined) {
                    adjustedTranslations[i] = cleanText(translatedTexts[i]);
                }
            }
            return adjustedTranslations;
        }
        
        // アイテム数が一致した場合も、各要素に対してクリーニング処理
        return translatedTexts.map(text => cleanText(text));

    } catch (e) {
        throw new Error(e.message || '翻訳レスポンスの解析に失敗しました。');
    }
}

function putObjectValue(obj, key, value) {
    const keys = key.split('##');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (!current[k]) {
            current[k] = {};
        }
        current = current[k];
    }

    current[keys[keys.length - 1]] = value;
}

const TRANSLATION_CHUNK_SIZE = 50; // 1回のAPI呼び出しで翻訳するアイテム数
const REQUEST_INTERVAL_MS = 6500; // 10 RPM (6秒/リクエスト) + バッファ0.5秒

async function resolveTranslatedText(originalItem, translatedText, targetLanguageLabel) {
    if (translatedText && translatedText.length > 0) {
        return translatedText;
    }

    // バッチ結果が空だった項目のみ、単体リクエストで再試行する
    try {
        const retryTranslations = await doTranslate([originalItem.message], targetLanguageLabel);
        const retriedText = retryTranslations[0] || '';
        if (retriedText.length > 0) {
            console.log(`単体リトライ成功: key "${originalItem.key}" => "${retriedText.substring(0, 50)}..."`);
        }
        return retriedText;
    } catch (retryError) {
        console.warn(`単体リトライ失敗: key "${originalItem.key}" (${retryError.message})`);
        return '';
    }
}

async function applyChunkTranslations(chunk, translatedMessages, targetLanguageLabel, targetObject) {
    let translatedCount = 0;

    for (let index = 0; index < chunk.length; index++) {
        const originalItem = chunk[index];
        const translatedText = await resolveTranslatedText(
            originalItem,
            translatedMessages[index],
            targetLanguageLabel,
        );

        if (translatedText && translatedText.length > 0) {
            console.log(`翻訳成功: key "${originalItem.key}" => "${translatedText.substring(0, 50)}..."`); // 長い翻訳は一部表示
            putObjectValue(targetObject, originalItem.key, translatedText);
            translatedCount++;
        } else {
            console.log(`翻訳結果が空またはエラー: key "${originalItem.key}" はスキップされました。`);
        }
    }

    return translatedCount;
}

function logChunkError(error, chunk) {
    console.error(`チャンク翻訳中にエラーが発生しました: ${error.message}`);
    console.error('エラーが発生したチャンクのキー (最初の5件):');
    chunk.slice(0, 5).forEach((originalItem) => {
        console.error(`  - ${originalItem.key}`);
    });
}

async function translate(waitTranslateList, targetObject, targetLanguageLabel) {
    let totalTranslatedCount = 0;
    const totalItems = waitTranslateList.length;

    console.log(`翻訳開始: 合計 ${totalItems} アイテム, チャンクサイズ: ${TRANSLATION_CHUNK_SIZE}`);

    for (let i = 0; i < totalItems; i += TRANSLATION_CHUNK_SIZE) {
        const chunk = waitTranslateList.slice(i, i + TRANSLATION_CHUNK_SIZE);
        const messagesInChunk = chunk.map(item => item.message); // 原文メッセージの配列

        if (messagesInChunk.length === 0) continue;

        console.log(`チャンク ${Math.floor(i / TRANSLATION_CHUNK_SIZE) + 1} / ${Math.ceil(totalItems / TRANSLATION_CHUNK_SIZE)} を翻訳中 (${chunk.length} アイテム)...`);

        try {
            // doTranslate は常に messagesInChunk と同じ長さの配列を返す
            // (件数が合わない場合も内部で補正する)か throw するため、
            // 長さの不一致は発生しない。
            const translatedMessages = await doTranslate(messagesInChunk, targetLanguageLabel);
            totalTranslatedCount += await applyChunkTranslations(
                chunk,
                translatedMessages,
                targetLanguageLabel,
                targetObject,
            );
        } catch (e) {
            logChunkError(e, chunk);
        }

        console.log(`処理済みアイテム: ${Math.min(i + TRANSLATION_CHUNK_SIZE, totalItems)} / ${totalItems}`);
        console.log(`現在までの成功翻訳数: ${totalTranslatedCount}`);

        if (i + TRANSLATION_CHUNK_SIZE < totalItems) {
            console.log(`${REQUEST_INTERVAL_MS / 1000}秒待機します...`);
            await new Promise(resolve => setTimeout(resolve, REQUEST_INTERVAL_MS));
        }
    }
    console.log(`翻訳完了。合計 ${totalTranslatedCount} / ${totalItems} アイテムが翻訳されました。`);
}

// 翻訳が必要なキーとメッセージを収集する
function collectMessages(oldSourceLanguages, newSourceLanguages, targetLanguages, parentKey = '', waitTranslateList=[]){
    for (const key in newSourceLanguages) {
        let currentKey = parentKey ? parentKey + "##" + key : key;
        if (newSourceLanguages[key] instanceof Object) {
            collectMessages(oldSourceLanguages[key]  || {}, newSourceLanguages[key], targetLanguages[key] || {}, currentKey, waitTranslateList);
        } else if (targetLanguages[key] === undefined
            || oldSourceLanguages[key] === undefined
            || oldSourceLanguages[key] !== newSourceLanguages[key]) {
            waitTranslateList.push({
                key: currentKey,
                message: newSourceLanguages[key]
            })
        }
    }
}


function loadOldEnLanguages(localEnFilePath) {
    if (!fs.existsSync(localEnFilePath)) {
        console.warn(`${localEnFilePath} が見つかりません。空のオブジェクトとして扱います。`);
        return {};
    }
    try {
        return require(localEnFilePath); // ローカルの古い英語言語ファイル
    } catch (e) {
        console.warn(`${localEnFilePath} の読み込みに失敗しました。空のオブジェクトとして扱います。エラー:`, e);
        return {};
    }
}

function loadExistingTargetJson(fileName) {
    if (!fs.existsSync(fileName)) {
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(fileName, "utf8")); // 既存の翻訳ファイルを読み込み
    } catch (e) {
        console.error(`${fileName} の読み込みまたは解析に失敗しました。空のオブジェクトとして扱います。エラー:`, e);
        return {};
    }
}

function sortTargetJsonByKeyOrder(newEnLanguages, targetJson) {
    const sortedTargetLanguages = {};
    for (const key in newEnLanguages) { // 最新の英語ファイルのキー順でソート
        if (targetJson[key] !== undefined) {
            sortedTargetLanguages[key] = targetJson[key];
        }
    }
    return sortedTargetLanguages;
}

async function processTargetLanguage(targetLanguage, oldEnLanguages, newEnLanguages) {
    // 翻訳ファイルのパスを __dirname (scriptディレクトリ) からの相対パスで解決
    const fileName = path.join(__dirname, '..', 'languages', `${targetLanguage.name}.json`);
    const targetJson = loadExistingTargetJson(fileName);

    const waitTranslateList = [] // 翻訳待ちリスト
    collectMessages(oldEnLanguages, newEnLanguages, targetJson, "", waitTranslateList); // 翻訳が必要なアイテムを収集

    if (waitTranslateList.length === 0) {
        console.log(`${targetLanguage.label} の翻訳対象アイテムはありませんでした。既存の翻訳ファイルを保持します。`);
        return; // 次の言語へ
    }

    await translate(waitTranslateList, targetJson, targetLanguage.label); // 翻訳処理を実行

    // newEnLanguages のキー順序に基づいて targetJson をソートする
    const sortedTargetLanguages = sortTargetJsonByKeyOrder(newEnLanguages, targetJson);
    // 翻訳後の言語ファイルを書き出す
    fs.writeFileSync(fileName, JSON.stringify(sortedTargetLanguages, null, 4));
    console.log(`${fileName} にソート済みの翻訳を書き込みました。`);
}

async function run(){
    const activeModel = AI_PROVIDER === 'openai' ? OPENAI_MODEL : GEMINI_MODEL;
    console.log(`使用するAIプロバイダ: ${AI_PROVIDER}`);
    console.log(`使用するモデル: ${activeModel}`);

    const localEnFilePath = path.join(__dirname, "en.json"); // スクリプトと同じディレクトリの en.json
    const oldEnLanguages = loadOldEnLanguages(localEnFilePath);
    const targetLanguages = resolveTargetLanguages();

    const localeSourceUrls = [
        'https://raw.githubusercontent.com/n8n-io/n8n/master/packages/frontend/@n8n/i18n/src/locales/en.json',
        'https://raw.githubusercontent.com/n8n-io/n8n/main/packages/frontend/@n8n/i18n/src/locales/en.json',
        'https://raw.githubusercontent.com/n8n-io/n8n/master/packages/frontend/editor-ui/src/plugins/i18n/locales/en.json',
        'https://ghfast.top/https://raw.githubusercontent.com/n8n-io/n8n/master/packages/frontend/@n8n/i18n/src/locales/en.json',
    ];

    const newEnLanguages = await fetchJsonWithFallback(localeSourceUrls)
        .catch(err => {
            console.error('最新の英語言語ファイルの取得に失敗しました:', err.message || err);
            console.log('ローカルの en.json を使用して続行します。');
            return oldEnLanguages; // フォールバックとしてローカルファイルを使用 (読み込めていれば)
        });

    for (const targetLanguage of targetLanguages) {
        await processTargetLanguage(targetLanguage, oldEnLanguages, newEnLanguages);
    }
    // ローカルの英語言語ファイルを最新版に更新
    fs.writeFileSync(localEnFilePath, JSON.stringify(newEnLanguages, null, 4));
    console.log(`${localEnFilePath} を最新版に更新しました。`);
}

module.exports = {
    validateProviderConfig,
    generateUniqueSeparator,
    parseApiErrorText,
    extractRetryDelayMs,
    buildOpenAIRequestBody,
    buildGeminiRequestBody,
    buildGeminiModelCandidates,
    extractCombinedTranslations,
    postGemini,
    postOpenAI,
    requestWithRetries,
    requestGeminiWithFallback,
    requestOpenAI,
    fetchJsonWithFallback,
    doTranslate,
    putObjectValue,
    collectMessages,
    resolveTranslatedText,
    applyChunkTranslations,
    logChunkError,
    translate,
    loadOldEnLanguages,
    loadExistingTargetJson,
    sortTargetJsonByKeyOrder,
    processTargetLanguage,
    resolveTargetLanguages,
};

if (require.main === module) {
    validateProviderConfig();
    run().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
