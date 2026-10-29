const fs = require('node:fs');
const path = require('node:path');
const { translate } = require('google-translate-api-x');

const EN_PATH = path.join(__dirname, 'en.json');
const JA_PATH = path.join(__dirname, '..', 'languages', 'ja.json');

const MAX_RETRIES = Number(process.env.GOOGLE_TRANSLATE_MAX_RETRIES || 5);
const RETRY_DELAY_MS = Number(process.env.GOOGLE_TRANSLATE_RETRY_DELAY_MS || 1500);
const REQUEST_DELAY_MS = Number(process.env.GOOGLE_TRANSLATE_REQUEST_DELAY_MS || 30);
const TRANSLATE_CONCURRENCY = Math.max(1, Number(process.env.GOOGLE_TRANSLATE_CONCURRENCY || 4));
const SAVE_EVERY = Math.max(1, Number(process.env.GOOGLE_TRANSLATE_SAVE_EVERY || 25));
const DRY_RUN = /^(1|true|yes)$/i.test(String(process.env.GOOGLE_TRANSLATE_DRY_RUN || ''));

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveJson(filePath, value) {
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isPlainObject(value) {
	return value && typeof value === 'object' && !Array.isArray(value);
}

function protectText(source) {
	const placeholders = [];

	const protect = (pattern, text) => text.replace(pattern, (match) => {
		const token = `__N8N_I18N_TOKEN_${placeholders.length}__`;
		placeholders.push(match);
		return token;
	});

	let protectedText = source;
	protectedText = protect(/\{[^{}]+\}/g, protectedText);
	protectedText = protect(/<[^>]{1,2000}>/g, protectedText);

	return { protectedText, placeholders };
}

function restoreText(translated, placeholders) {
	let restored = translated;
	for (let index = 0; index < placeholders.length; index += 1) {
		restored = restored.replaceAll(`__N8N_I18N_TOKEN_${index}__`, placeholders[index]);
	}
	return restored;
}

function normalizeJapaneseText(text) {
	if (typeof text !== 'string') {
		return text;
	}

	const jpOrPunct = '[\\u3040-\\u30FF\\u3400-\\u9FFFー々、。・「」（）『』【】！？：；]';
	let normalized = text;

	// 和文や和文句読点の間に誤って入った半角スペースを除去
	normalized = normalized.replace(new RegExp(String.raw`(${jpOrPunct})\s+(${jpOrPunct})`, 'g'), '$1$2');

	// 全角かっこ内側の不要スペースを除去
	normalized = normalized
		.replace(/（\s+/g, '（')
		.replace(/\s{1,200}）/g, '）')
		.replace(/「\s+/g, '「')
		.replace(/\s{1,200}」/g, '」');

	return normalized.trim();
}

function isLikelyNonTranslatable(text) {
	const source = text.trim();
	if (!source) {
		return true;
	}

	if (/^https?:\/\//i.test(source)) {
		return true;
	}

	if (/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(source)) {
		return true;
	}

	if (/^[A-Za-z0-9_.:/#?&=%@+-]+$/.test(source)) {
		return true;
	}

	if (/^[A-Za-z][A-Za-z0-9]*(?:[._:][A-Za-z0-9]+)+$/.test(source)) {
		return true;
	}

	if (/^[0-9\s.,:;!?()[\]{}\-_/|]+$/.test(source)) {
		return true;
	}

	return false;
}

async function translateWithRetry(sourceText) {
	if (isLikelyNonTranslatable(sourceText)) {
		return sourceText;
	}

	const { protectedText, placeholders } = protectText(sourceText);
	let lastError;

	for (let i = 0; i <= MAX_RETRIES; i += 1) {
		try {
			const result = await translate(protectedText, { to: 'ja' });
			const restored = restoreText(result.text || sourceText, placeholders);
			return normalizeJapaneseText(restored);
		} catch (error) {
			lastError = error;
			if (i === MAX_RETRIES) {
				break;
			}
			await sleep(RETRY_DELAY_MS * (i + 1));
		}
	}

	throw lastError;
}

function shouldTranslate(enValue, jaValue) {
	if (typeof enValue !== 'string') {
		return false;
	}
	if (isLikelyNonTranslatable(enValue)) {
		return false;
	}
	if (typeof jaValue !== 'string') {
		return true;
	}
	if (!jaValue.trim()) {
		return true;
	}
	return jaValue === enValue;
}

function collectTasks(enNode, jaNode, keyPath = [], tasks = []) {
	if (typeof enNode === 'string') {
		if (shouldTranslate(enNode, jaNode)) {
			tasks.push({ keyPath, sourceText: enNode });
		}
		return tasks;
	}

	if (Array.isArray(enNode)) {
		enNode.forEach((item, index) => {
			const nextPath = [...keyPath, index];
			const nextJa = Array.isArray(jaNode) ? jaNode[index] : undefined;
			collectTasks(item, nextJa, nextPath, tasks);
		});
		return tasks;
	}

	if (isPlainObject(enNode)) {
		Object.entries(enNode).forEach(([key, value]) => {
			const nextPath = [...keyPath, key];
			const nextJa = isPlainObject(jaNode) ? jaNode[key] : undefined;
			collectTasks(value, nextJa, nextPath, tasks);
		});
	}

	return tasks;
}

function setByPath(target, segments, value) {
	let current = target;

	for (let i = 0; i < segments.length; i += 1) {
		const raw = segments[i];
		const isLast = i === segments.length - 1;
		const nextRaw = segments[i + 1];
		const key = raw;
		const nextIsIndex = typeof nextRaw === 'number';

		if (isLast) {
			current[key] = value;
			return;
		}

		if (current[key] === undefined) {
			current[key] = nextIsIndex ? [] : {};
		}

		current = current[key];
	}
}

async function main() {
	const enJson = loadJson(EN_PATH);
	const jaJson = fs.existsSync(JA_PATH) ? loadJson(JA_PATH) : {};
	const tasks = collectTasks(enJson, jaJson);

	console.log(`Translation tasks: ${tasks.length} (concurrency=${TRANSLATE_CONCURRENCY}, dryRun=${DRY_RUN})`);
	let done = 0;
	let failed = 0;
	let cursor = 0;

	const updateProgress = () => {
		if (done % 100 === 0 || done === tasks.length) {
			console.log(`Translated ${done}/${tasks.length}`);
		}

		if (!DRY_RUN && done % SAVE_EVERY === 0) {
			saveJson(JA_PATH, jaJson);
		}
	};

	const worker = async () => {
		while (true) {
			const index = cursor;
			cursor += 1;
			if (index >= tasks.length) {
				return;
			}

			const task = tasks[index];

			try {
				const translated = await translateWithRetry(task.sourceText);
				if (!DRY_RUN) {
					setByPath(jaJson, task.keyPath, translated);
				}
				done += 1;
				updateProgress();

				if (REQUEST_DELAY_MS > 0) {
					await sleep(REQUEST_DELAY_MS);
				}
			} catch (error) {
				failed += 1;
				console.warn(`Failed: ${task.keyPath.join('.')}`);
				console.warn(error?.message || error);
			}
		}
	};

	const workers = [];
	for (let i = 0; i < TRANSLATE_CONCURRENCY; i += 1) {
		workers.push(worker());
	}

	await Promise.all(workers);

	if (!DRY_RUN) {
		saveJson(JA_PATH, jaJson);
	}
	console.log(`Done. success=${done}, failed=${failed}`);

	if (DRY_RUN) {
		console.log('Dry run mode: languages/ja.json is not modified.');
	}
}

module.exports = {
	sleep,
	protectText,
	restoreText,
	normalizeJapaneseText,
	isLikelyNonTranslatable,
	shouldTranslate,
	collectTasks,
	setByPath,
};

if (require.main === module) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
