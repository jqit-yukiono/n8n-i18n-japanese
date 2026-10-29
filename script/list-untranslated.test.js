const { walk, run } = require('./list-untranslated');

describe('walk', () => {
    it('finds top-level keys where ja still equals en', () => {
        const en = { greeting: 'Hello' };
        const ja = { greeting: 'Hello' };
        expect(walk(en, ja, '')).toEqual(['greeting']);
    });

    it('does not flag keys that have been translated', () => {
        const en = { greeting: 'Hello' };
        const ja = { greeting: 'こんにちは' };
        expect(walk(en, ja, '')).toEqual([]);
    });

    it('recurses into nested objects and builds dotted keys', () => {
        const en = { auth: { login: { title: 'Sign in' } } };
        const ja = { auth: { login: { title: 'Sign in' } } };
        expect(walk(en, ja, '')).toEqual(['auth.login.title']);
    });

    it('ignores keys missing from the ja side', () => {
        const en = { greeting: 'Hello' };
        expect(walk(en, undefined, '')).toEqual([]);
    });

    it('prefixes nested keys with the given prefix', () => {
        const en = { title: 'Hello' };
        const ja = { title: 'Hello' };
        expect(walk(en, ja, 'root')).toEqual(['root.title']);
    });
});

describe('run', () => {
    it('reads en.json/ja.json and prints the untranslated key count without throwing', () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        try {
            run();
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('untranslated count:'));
        } finally {
            logSpy.mockRestore();
        }
    });
});
