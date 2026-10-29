const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

jest.mock('google-translate-api-x', () => ({ translate: jest.fn() }));

const {
	sleep,
	loadJson,
	saveJson,
	protectText,
	restoreText,
	normalizeJapaneseText,
	isLikelyNonTranslatable,
	shouldTranslate,
	collectTasks,
	setByPath,
} = require('./translate-google');

describe('protectText / restoreText', () => {
	it('replaces placeholders and tags with tokens, then restores them', () => {
		const source = 'Hello {name}, click <b>here</b>.';
		const { protectedText, placeholders } = protectText(source);

		expect(protectedText).not.toContain('{name}');
		expect(protectedText).not.toContain('<b>');
		expect(placeholders).toEqual(['{name}', '<b>', '</b>']);

		const restored = restoreText(protectedText, placeholders);
		expect(restored).toBe(source);
	});

	it('leaves text without placeholders/tags untouched', () => {
		const { protectedText, placeholders } = protectText('plain text');
		expect(protectedText).toBe('plain text');
		expect(placeholders).toEqual([]);
	});
});

describe('normalizeJapaneseText', () => {
	it('removes stray half-width spaces between Japanese characters', () => {
		expect(normalizeJapaneseText('あ　い')).toBe('あい');
	});

	it('removes spaces just inside full-width parentheses/brackets', () => {
		expect(normalizeJapaneseText('（ 例 ）')).toBe('（例）');
		expect(normalizeJapaneseText('「 引用 」')).toBe('「引用」');
	});

	it('returns non-string input unchanged', () => {
		expect(normalizeJapaneseText(42)).toBe(42);
		expect(normalizeJapaneseText(null)).toBe(null);
	});

	it('trims leading/trailing whitespace', () => {
		expect(normalizeJapaneseText('  hello  ')).toBe('hello');
	});
});

describe('isLikelyNonTranslatable', () => {
	it('treats empty/whitespace-only text as non-translatable', () => {
		expect(isLikelyNonTranslatable('   ')).toBe(true);
	});

	it('treats URLs as non-translatable', () => {
		expect(isLikelyNonTranslatable('https://example.com/path')).toBe(true);
	});

	it('treats email addresses as non-translatable', () => {
		expect(isLikelyNonTranslatable('user@example.com')).toBe(true);
	});

	it('treats identifier-like tokens as non-translatable', () => {
		expect(isLikelyNonTranslatable('node.io/path#frag')).toBe(true);
		expect(isLikelyNonTranslatable('n8n.workflow.id')).toBe(true);
	});

	it('treats pure punctuation/number strings as non-translatable', () => {
		expect(isLikelyNonTranslatable('1,234 (5)')).toBe(true);
	});

	it('treats ordinary sentences as translatable', () => {
		expect(isLikelyNonTranslatable('Click here to continue')).toBe(false);
	});
});

describe('shouldTranslate', () => {
	it('skips non-string source values', () => {
		expect(shouldTranslate(42, 'foo')).toBe(false);
	});

	it('skips values that look non-translatable', () => {
		expect(shouldTranslate('https://example.com', undefined)).toBe(false);
	});

	it('translates when there is no existing ja value', () => {
		expect(shouldTranslate('Hello world', undefined)).toBe(true);
	});

	it('translates when the existing ja value is blank', () => {
		expect(shouldTranslate('Hello world', '   ')).toBe(true);
	});

	it('translates when ja still equals the English source', () => {
		expect(shouldTranslate('Hello world', 'Hello world')).toBe(true);
	});

	it('does not retranslate when ja already differs from en', () => {
		expect(shouldTranslate('Hello world', 'こんにちは')).toBe(false);
	});
});

describe('collectTasks', () => {
	it('collects leaf strings that need translation with their key paths', () => {
		const en = { greeting: 'Hello world', nested: { title: 'Welcome back' } };
		const ja = { greeting: 'Hello world' };
		const tasks = collectTasks(en, ja);

		expect(tasks).toEqual([
			{ keyPath: ['greeting'], sourceText: 'Hello world' },
			{ keyPath: ['nested', 'title'], sourceText: 'Welcome back' },
		]);
	});

	it('walks arrays and tracks numeric indices in the key path', () => {
		const en = { items: ['Hello world', 'Good morning'] };
		const ja = { items: ['Hello world'] };
		const tasks = collectTasks(en, ja);

		expect(tasks).toEqual([
			{ keyPath: ['items', 0], sourceText: 'Hello world' },
			{ keyPath: ['items', 1], sourceText: 'Good morning' },
		]);
	});

	it('does not emit a task for already-translated leaves', () => {
		const en = { greeting: 'Hello world' };
		const ja = { greeting: 'こんにちは' };
		expect(collectTasks(en, ja)).toEqual([]);
	});
});

describe('setByPath', () => {
	it('sets a top-level key', () => {
		const target = {};
		setByPath(target, ['greeting'], 'こんにちは');
		expect(target).toEqual({ greeting: 'こんにちは' });
	});

	it('creates intermediate objects as needed', () => {
		const target = {};
		setByPath(target, ['nested', 'title'], 'タイトル');
		expect(target).toEqual({ nested: { title: 'タイトル' } });
	});

	it('creates intermediate arrays when the next segment is numeric', () => {
		const target = {};
		setByPath(target, ['items', 0], 'こんにちは');
		expect(target).toEqual({ items: ['こんにちは'] });
	});

	it('overwrites an existing value at the path', () => {
		const target = { greeting: 'old' };
		setByPath(target, ['greeting'], 'new');
		expect(target.greeting).toBe('new');
	});
});

describe('sleep', () => {
	it('resolves after the given delay', async () => {
		await expect(sleep(1)).resolves.toBeUndefined();
	});
});

describe('loadJson / saveJson', () => {
	let tmpFile;

	afterEach(() => {
		if (tmpFile && fs.existsSync(tmpFile)) {
			fs.rmSync(tmpFile);
		}
	});

	it('round-trips a JSON value through saveJson/loadJson', () => {
		tmpFile = path.join(os.tmpdir(), `translate-google-test-${Date.now()}.json`);
		saveJson(tmpFile, { greeting: 'こんにちは' });
		expect(loadJson(tmpFile)).toEqual({ greeting: 'こんにちは' });
	});
});

describe('translateWithRetry (google-translate-api-x をモック)', () => {
	const ORIGINAL_ENV = { ...process.env };

	afterEach(() => {
		process.env = { ...ORIGINAL_ENV };
		jest.resetModules();
	});

	function loadWithFastRetry() {
		jest.resetModules();
		process.env.GOOGLE_TRANSLATE_RETRY_DELAY_MS = '1';
		process.env.GOOGLE_TRANSLATE_MAX_RETRIES = '2';
		const mod = require('./translate-google');
		const { translate: mockTranslate } = require('google-translate-api-x');
		mockTranslate.mockReset();
		return { mod, mockTranslate };
	}

	it('returns the translated text on first success', async () => {
		const { mod, mockTranslate } = loadWithFastRetry();
		mockTranslate.mockResolvedValue({ text: 'こんにちは' });
		const result = await mod.translateWithRetry('Hello world');
		expect(result).toBe('こんにちは');
		expect(mockTranslate).toHaveBeenCalledTimes(1);
	});

	it('retries after a transient failure and eventually succeeds', async () => {
		const { mod, mockTranslate } = loadWithFastRetry();
		mockTranslate
			.mockRejectedValueOnce(new Error('network blip'))
			.mockResolvedValueOnce({ text: 'こんにちは' });
		const result = await mod.translateWithRetry('Hello world');
		expect(result).toBe('こんにちは');
		expect(mockTranslate).toHaveBeenCalledTimes(2);
	});

	it('throws the last error once retries are exhausted', async () => {
		const { mod, mockTranslate } = loadWithFastRetry();
		mockTranslate.mockRejectedValue(new Error('persistent failure'));
		await expect(mod.translateWithRetry('Hello world')).rejects.toThrow('persistent failure');
		expect(mockTranslate).toHaveBeenCalledTimes(3); // 初回 + MAX_RETRIES(2)
	});

	it('skips the API call entirely for non-translatable text', async () => {
		const { mod, mockTranslate } = loadWithFastRetry();
		const result = await mod.translateWithRetry('https://example.com');
		expect(result).toBe('https://example.com');
		expect(mockTranslate).not.toHaveBeenCalled();
	});

	it('falls back to the original text when the API returns no text', async () => {
		const { mod, mockTranslate } = loadWithFastRetry();
		mockTranslate.mockResolvedValue({ text: undefined });
		const result = await mod.translateWithRetry('Hello world');
		expect(result).toBe('Hello world');
	});
});
