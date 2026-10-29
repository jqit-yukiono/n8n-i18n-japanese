const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const {
    generateUniqueSeparator,
    parseApiErrorText,
    extractRetryDelayMs,
    buildOpenAIRequestBody,
    buildGeminiRequestBody,
    buildGeminiModelCandidates,
    extractCombinedTranslations,
    doTranslate,
    putObjectValue,
    collectMessages,
    loadOldEnLanguages,
    loadExistingTargetJson,
    sortTargetJsonByKeyOrder,
    processTargetLanguage,
    resolveTargetLanguages,
} = require('./translate');

function mockGeminiFetchOnce(responseText) {
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: responseText }] } }] }),
    });
}

describe('generateUniqueSeparator', () => {
    it('produces a separator wrapped in the expected markers', () => {
        const sep = generateUniqueSeparator();
        expect(sep.startsWith('__TRANSLATION_ITEM_SEPARATOR_')).toBe(true);
        expect(sep.endsWith('__')).toBe(true);
    });

    it('produces a different value on each call', () => {
        expect(generateUniqueSeparator()).not.toBe(generateUniqueSeparator());
    });
});

describe('parseApiErrorText', () => {
    it('parses JSON error bodies', () => {
        expect(parseApiErrorText('{"error":{"message":"boom"}}')).toEqual({ error: { message: 'boom' } });
    });

    it('returns the raw text when it is not JSON', () => {
        expect(parseApiErrorText('not json')).toBe('not json');
    });
});

describe('extractRetryDelayMs', () => {
    it('extracts the retry delay from a Gemini-style message and adds buffer', () => {
        const errorData = { error: { message: 'Please retry in 20s.' } };
        expect(extractRetryDelayMs(errorData)).toBe(21000); // ceil(20000) + 1000 buffer
    });

    it('falls back to the minimum retry delay when no delay is present', () => {
        expect(extractRetryDelayMs({ error: { message: 'rate limited' } })).toBe(8000);
    });

    it('falls back to the minimum retry delay for a non-finite/zero delay', () => {
        expect(extractRetryDelayMs({ error: { message: 'Please retry in 0s.' } })).toBe(8000);
    });

    it('accepts a plain string error message', () => {
        expect(extractRetryDelayMs('Please retry in 10s.')).toBe(11000);
    });
});

describe('buildOpenAIRequestBody / buildGeminiRequestBody', () => {
    it('builds a well-formed OpenAI chat completion body', () => {
        const body = JSON.parse(buildOpenAIRequestBody('translate this'));
        expect(body.messages[1]).toEqual({ role: 'user', content: 'translate this' });
    });

    it('builds a well-formed Gemini generateContent body', () => {
        const body = JSON.parse(buildGeminiRequestBody('translate this'));
        expect(body.contents[0].parts[0].text).toBe('translate this');
    });
});

describe('buildGeminiModelCandidates', () => {
    it('deduplicates and keeps the configured model first', () => {
        expect(buildGeminiModelCandidates('gemini-1.5-flash')).toEqual([
            'gemini-1.5-flash',
            'gemini-2.0-flash',
        ]);
    });

    it('adds a stable fallback for preview models', () => {
        expect(buildGeminiModelCandidates('gemini-2.5-flash-preview-05-20')).toEqual([
            'gemini-2.5-flash-preview-05-20',
            'gemini-2.5-flash',
            'gemini-2.0-flash',
            'gemini-1.5-flash',
        ]);
    });
});

describe('extractCombinedTranslations', () => {
    it('extracts text from a well-formed Gemini response', () => {
        const data = { candidates: [{ content: { parts: [{ text: ' hello ' }] } }] };
        expect(extractCombinedTranslations(data)).toBe('hello');
    });

    it('throws when the Gemini response has no usable text', () => {
        expect(() => extractCombinedTranslations({})).toThrow();
    });
});

describe('putObjectValue', () => {
    it('sets a nested value using the ## key separator', () => {
        const obj = {};
        putObjectValue(obj, 'a##b##c', 'value');
        expect(obj).toEqual({ a: { b: { c: 'value' } } });
    });

    it('sets a top-level value when there is no separator', () => {
        const obj = {};
        putObjectValue(obj, 'key', 'value');
        expect(obj).toEqual({ key: 'value' });
    });
});

describe('collectMessages', () => {
    it('collects a leaf whose translation is missing', () => {
        const list = [];
        collectMessages({}, { greeting: 'Hello' }, {}, '', list);
        expect(list).toEqual([{ key: 'greeting', message: 'Hello' }]);
    });

    it('collects a leaf whose English source changed since the old snapshot', () => {
        const list = [];
        collectMessages({ greeting: 'Hi' }, { greeting: 'Hello' }, { greeting: '古い訳' }, '', list);
        expect(list).toEqual([{ key: 'greeting', message: 'Hello' }]);
    });

    it('does not re-collect a leaf that is already translated and unchanged', () => {
        const list = [];
        collectMessages({ greeting: 'Hello' }, { greeting: 'Hello' }, { greeting: 'こんにちは' }, '', list);
        expect(list).toEqual([]);
    });

    it('recurses into nested objects using ## as the key separator', () => {
        const list = [];
        collectMessages({}, { auth: { login: 'Login' } }, {}, '', list);
        expect(list).toEqual([{ key: 'auth##login', message: 'Login' }]);
    });
});

describe('sortTargetJsonByKeyOrder', () => {
    it('reorders keys to match the English file order, dropping anything not in targetJson', () => {
        const newEn = { b: '2', a: '1', c: '3' };
        const targetJson = { a: 'あ', c: 'う' };
        expect(sortTargetJsonByKeyOrder(newEn, targetJson)).toEqual({ a: 'あ', c: 'う' });
        expect(Object.keys(sortTargetJsonByKeyOrder(newEn, targetJson))).toEqual(['a', 'c']);
    });
});

describe('loadOldEnLanguages', () => {
    let tmpFile;

    afterEach(() => {
        if (tmpFile && fs.existsSync(tmpFile)) {
            fs.rmSync(tmpFile);
        }
    });

    it('returns an empty object when the file does not exist', () => {
        expect(loadOldEnLanguages(path.join(os.tmpdir(), 'does-not-exist.json'))).toEqual({});
    });

    it('loads and parses an existing JSON file', () => {
        tmpFile = path.join(os.tmpdir(), `translate-test-${Date.now()}.json`);
        fs.writeFileSync(tmpFile, JSON.stringify({ greeting: 'Hello' }));
        expect(loadOldEnLanguages(tmpFile)).toEqual({ greeting: 'Hello' });
    });

    it('returns an empty object when the file exists but is not valid JSON', () => {
        tmpFile = path.join(os.tmpdir(), `translate-test-invalid-${Date.now()}.json`);
        fs.writeFileSync(tmpFile, '{not valid json');
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        expect(loadOldEnLanguages(tmpFile)).toEqual({});
        warnSpy.mockRestore();
    });
});

describe('loadExistingTargetJson', () => {
    let tmpFile;

    afterEach(() => {
        if (tmpFile && fs.existsSync(tmpFile)) {
            fs.rmSync(tmpFile);
        }
    });

    it('returns an empty object when the file does not exist', () => {
        expect(loadExistingTargetJson(path.join(os.tmpdir(), 'does-not-exist.json'))).toEqual({});
    });

    it('returns an empty object when the file contains invalid JSON', () => {
        tmpFile = path.join(os.tmpdir(), `translate-test-invalid-${Date.now()}.json`);
        fs.writeFileSync(tmpFile, '{not valid json');
        expect(loadExistingTargetJson(tmpFile)).toEqual({});
    });

    it('loads and parses an existing JSON file', () => {
        tmpFile = path.join(os.tmpdir(), `translate-test-${Date.now()}.json`);
        fs.writeFileSync(tmpFile, JSON.stringify({ greeting: 'こんにちは' }));
        expect(loadExistingTargetJson(tmpFile)).toEqual({ greeting: 'こんにちは' });
    });
});

describe('validateProviderConfig', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
    });

    function loadFreshModule(envOverrides) {
        jest.resetModules();
        process.env = { ...ORIGINAL_ENV, ...envOverrides };
        // eslint-disable-next-line global-require
        return require('./translate');
    }

    it('exits with an error when AI_PROVIDER=openai and OPENAI_API_KEY is missing', () => {
        const mod = loadFreshModule({ AI_PROVIDER: 'openai', OPENAI_API_KEY: '', GEMINI_API_KEY: 'dummy' });
        const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        mod.validateProviderConfig();

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('OPENAI_API_KEY'));
        exitSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('exits with an error when AI_PROVIDER=gemini and GEMINI_API_KEY is missing', () => {
        const mod = loadFreshModule({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: '', OPENAI_API_KEY: '' });
        const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        mod.validateProviderConfig();

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('GEMINI_API_KEY'));
        exitSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('exits with an error for an unsupported AI_PROVIDER', () => {
        const mod = loadFreshModule({ AI_PROVIDER: 'cohere', OPENAI_API_KEY: 'dummy', GEMINI_API_KEY: 'dummy' });
        const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        mod.validateProviderConfig();

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('未対応のAIプロバイダ'));
        exitSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('does not exit when the configured provider has its API key set', () => {
        const mod = loadFreshModule({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'dummy', OPENAI_API_KEY: '' });
        const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

        mod.validateProviderConfig();

        expect(exitSpy).not.toHaveBeenCalled();
        exitSpy.mockRestore();
    });
});

describe('doTranslate', () => {
    const ORIGINAL_FETCH = global.fetch;
    const ORIGINAL_TRANSLATION_PROMPT = process.env.TRANSLATION_PROMPT;

    afterEach(() => {
        global.fetch = ORIGINAL_FETCH;
        if (ORIGINAL_TRANSLATION_PROMPT === undefined) {
            delete process.env.TRANSLATION_PROMPT;
        } else {
            process.env.TRANSLATION_PROMPT = ORIGINAL_TRANSLATION_PROMPT;
        }
    });

    it('returns an empty array when there is nothing to translate', async () => {
        expect(await doTranslate([], 'Japanese')).toEqual([]);
    });

    it('splits a multi-item response on the generated separator and cleans each item', async () => {
        delete process.env.TRANSLATION_PROMPT;
        const separatorRe = /(__TRANSLATION_ITEM_SEPARATOR_\d+__[0-9a-f-]+__)/;
        global.fetch = jest.fn().mockImplementation(async (_url, init) => {
            const sentPrompt = JSON.parse(init.body).contents[0].parts[0].text;
            const [, uniqueSeparator] = sentPrompt.match(separatorRe);
            const responseText = [
                '承知しました、翻訳します：ITEM_START [1] こんにちは ITEM_END',
                'ITEM_START [2] さようなら ITEM_END',
            ].join(`\n${uniqueSeparator}\n`);
            return {
                ok: true,
                json: async () => ({ candidates: [{ content: { parts: [{ text: responseText }] } }] }),
            };
        });

        const result = await doTranslate(['Hello', 'Goodbye'], 'Japanese');
        expect(result).toEqual(['こんにちは', 'さようなら']);
    });

    it('cleans a single-item response and removes greeting/marker boilerplate', async () => {
        mockGeminiFetchOnce('承知しました、翻訳します：ITEM_START [1] こんにちは ITEM_END');
        const [translated] = await doTranslate(['Hello'], 'Japanese');
        expect(translated).toBe('こんにちは');
    });

    it('substitutes a custom TRANSLATION_PROMPT template via replaceAll', async () => {
        process.env.TRANSLATION_PROMPT = 'LANG=${language} SEP=${uniqueSeparator} TEXT=${textsToTranslate}';
        let capturedBody;
        global.fetch = jest.fn().mockImplementation(async (_url, init) => {
            capturedBody = init.body;
            return {
                ok: true,
                json: async () => ({ candidates: [{ content: { parts: [{ text: 'ITEM_START [1] こんにちは ITEM_END' }] } }] }),
            };
        });

        await doTranslate(['Hello'], 'Japanese');

        const sentPrompt = JSON.parse(capturedBody).contents[0].parts[0].text;
        expect(sentPrompt.startsWith('LANG=Japanese SEP=')).toBe(true);
        expect(sentPrompt).not.toContain('${language}');
        expect(sentPrompt).not.toContain('${textsToTranslate}');
    });

    it('returns empty strings for every item when the split count is wildly larger than expected', async () => {
        const separatorRe = /(__TRANSLATION_ITEM_SEPARATOR_\d+__[0-9a-f-]+__)/;
        global.fetch = jest.fn().mockImplementation(async (_url, init) => {
            const sentPrompt = JSON.parse(init.body).contents[0].parts[0].text;
            const [, uniqueSeparator] = sentPrompt.match(separatorRe);
            // 2項目しか頼んでいないのに5分割されるレスポンス(区切り文字の解釈失敗を模す)
            const responseText = Array.from({ length: 5 }, (_, i) => `item${i}`).join(`\n${uniqueSeparator}\n`);
            return {
                ok: true,
                json: async () => ({ candidates: [{ content: { parts: [{ text: responseText }] } }] }),
            };
        });

        const result = await doTranslate(['Hello', 'World'], 'Japanese');
        expect(result).toEqual(['', '']);
    });
});

describe('processTargetLanguage', () => {
    // 実在の言語ファイルに影響しないよう、存在しない言語名を使う。
    const TEST_LANGUAGE = { name: '__sonar_test__', label: 'TestLang' };
    const testFilePath = path.join(__dirname, '..', 'languages', '__sonar_test__.json');
    const ORIGINAL_FETCH = global.fetch;

    afterEach(() => {
        global.fetch = ORIGINAL_FETCH;
        if (fs.existsSync(testFilePath)) {
            fs.rmSync(testFilePath);
        }
    });

    it('keeps the existing translation file untouched when there is nothing new to translate', async () => {
        // ja 側に既に訳がある状態を再現する（en 側も変化していない）。
        fs.writeFileSync(testFilePath, JSON.stringify({ greeting: 'こんにちは' }));
        const fetchSpy = jest.fn();
        global.fetch = fetchSpy;
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        await processTargetLanguage(TEST_LANGUAGE, { greeting: 'Hello' }, { greeting: 'Hello' });

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(JSON.parse(fs.readFileSync(testFilePath, 'utf8'))).toEqual({ greeting: 'こんにちは' });
        logSpy.mockRestore();
    });

    it('translates missing items and writes the sorted result to the language file', async () => {
        mockGeminiFetchOnce('ITEM_START [1] こんにちは ITEM_END');
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        await processTargetLanguage(TEST_LANGUAGE, {}, { greeting: 'Hello' });

        expect(fs.existsSync(testFilePath)).toBe(true);
        expect(JSON.parse(fs.readFileSync(testFilePath, 'utf8'))).toEqual({ greeting: 'こんにちは' });
        logSpy.mockRestore();
    });
});

describe('resolveTargetLanguages', () => {
    const ORIGINAL_ENV = process.env.TARGET_LANGUAGES;

    afterEach(() => {
        if (ORIGINAL_ENV === undefined) {
            delete process.env.TARGET_LANGUAGES;
        } else {
            process.env.TARGET_LANGUAGES = ORIGINAL_ENV;
        }
    });

    it('falls back to the default (Japanese) when unset', () => {
        delete process.env.TARGET_LANGUAGES;
        expect(resolveTargetLanguages()).toEqual([{ name: 'ja', label: '日本語' }]);
    });

    it('parses a valid TARGET_LANGUAGES override', () => {
        process.env.TARGET_LANGUAGES = JSON.stringify([{ name: 'fr', label: 'Français' }]);
        expect(resolveTargetLanguages()).toEqual([{ name: 'fr', label: 'Français' }]);
    });

    it('falls back to the default when TARGET_LANGUAGES is malformed JSON', () => {
        process.env.TARGET_LANGUAGES = '{not valid';
        expect(resolveTargetLanguages()).toEqual([{ name: 'ja', label: '日本語' }]);
    });

    it('falls back to the default when entries are missing required fields', () => {
        process.env.TARGET_LANGUAGES = JSON.stringify([{ name: 'fr' }]);
        expect(resolveTargetLanguages()).toEqual([{ name: 'ja', label: '日本語' }]);
    });
});
