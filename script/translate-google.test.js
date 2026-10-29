const {
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
