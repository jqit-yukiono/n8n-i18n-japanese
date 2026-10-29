// main() は EN_PATH/JA_PATH (script/en.json, languages/ja.json) に直接
// read/write する CLI エントリーポイントのため、本番ファイルへの影響を避けて
// node:fs をモックしたこのファイルだけで検証する（他のテストとは別ファイルに
// 分離し、loadJson/saveJson の実ファイルI/Oテストに影響を与えないようにする）。
jest.mock('node:fs');
jest.mock('google-translate-api-x', () => ({ translate: jest.fn() }));

describe('main (node:fsをモックして本番ファイルに触れずに検証)', () => {
	const ORIGINAL_ENV = { ...process.env };

	afterEach(() => {
		process.env = { ...ORIGINAL_ENV };
		jest.resetModules();
		jest.clearAllMocks();
	});

	function loadFresh(envOverrides) {
		jest.resetModules();
		process.env = { ...ORIGINAL_ENV, ...envOverrides };
		// eslint-disable-next-line global-require
		const mod = require('./translate-google');
		// eslint-disable-next-line global-require
		const fs = require('node:fs');
		// eslint-disable-next-line global-require
		const { translate: mockTranslate } = require('google-translate-api-x');
		return { mod, fs, mockTranslate };
	}

	it('translates missing tasks and writes the result when not in dry-run', async () => {
		const { mod, fs, mockTranslate } = loadFresh({
			GOOGLE_TRANSLATE_DRY_RUN: 'false',
			GOOGLE_TRANSLATE_SAVE_EVERY: '1',
		});
		fs.existsSync.mockReturnValue(true);
		fs.readFileSync.mockImplementation((filePath) => (
			String(filePath).endsWith('en.json')
				? JSON.stringify({ greeting: 'Hello world' })
				: JSON.stringify({})
		));
		mockTranslate.mockResolvedValue({ text: 'こんにちは' });
		const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

		await mod.main();

		expect(fs.writeFileSync).toHaveBeenCalled();
		const [, written] = fs.writeFileSync.mock.calls.at(-1);
		expect(JSON.parse(written)).toEqual({ greeting: 'こんにちは' });
		logSpy.mockRestore();
	});

	it('does not write anything in dry-run mode', async () => {
		const { mod, fs, mockTranslate } = loadFresh({ GOOGLE_TRANSLATE_DRY_RUN: 'true' });
		fs.existsSync.mockReturnValue(true);
		fs.readFileSync.mockImplementation((filePath) => (
			String(filePath).endsWith('en.json')
				? JSON.stringify({ greeting: 'Hello world' })
				: JSON.stringify({})
		));
		mockTranslate.mockResolvedValue({ text: 'こんにちは' });
		const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

		await mod.main();

		expect(fs.writeFileSync).not.toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it('falls back to an empty object when the ja.json file does not exist yet', async () => {
		const { mod, fs, mockTranslate } = loadFresh({ GOOGLE_TRANSLATE_DRY_RUN: 'true' });
		fs.existsSync.mockReturnValue(false);
		fs.readFileSync.mockReturnValue(JSON.stringify({ greeting: 'Hello world' }));
		mockTranslate.mockResolvedValue({ text: 'こんにちは' });
		const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

		await expect(mod.main()).resolves.toBeUndefined();

		logSpy.mockRestore();
	});

	it('counts a task as failed when translation keeps throwing, without stopping the run', async () => {
		const { mod, fs, mockTranslate } = loadFresh({
			GOOGLE_TRANSLATE_DRY_RUN: 'true',
			GOOGLE_TRANSLATE_MAX_RETRIES: '0',
			GOOGLE_TRANSLATE_RETRY_DELAY_MS: '1',
		});
		fs.existsSync.mockReturnValue(false);
		fs.readFileSync.mockReturnValue(JSON.stringify({ greeting: 'Hello world' }));
		mockTranslate.mockRejectedValue(new Error('network down'));
		const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
		const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

		await expect(mod.main()).resolves.toBeUndefined();

		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed:'));
		logSpy.mockRestore();
		warnSpy.mockRestore();
	});
});
