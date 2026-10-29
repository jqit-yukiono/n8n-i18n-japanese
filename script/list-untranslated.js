// List keys whose ja value still equals the en value (likely untranslated).
const fs = require('node:fs');
const path = require('node:path');

const enPath = path.join(__dirname, 'en.json');
const jaPath = path.join(__dirname, '..', 'languages', 'ja.json');

const enRaw = fs.readFileSync(enPath, 'utf8');
const jaRaw = fs.readFileSync(jaPath, 'utf8');
const enData = JSON.parse(enRaw);
const jaData = JSON.parse(jaRaw);

function walk(enObj, jaObj, prefix) {
    const hits = [];
    for (const key in enObj) {
        const enVal = enObj[key];
        const jaVal = jaObj ? jaObj[key] : undefined;
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof enVal === 'object' && enVal !== null) {
            hits.push(...walk(enVal, jaVal, fullKey));
        } else if (typeof jaVal === 'string' && enVal === jaVal) {
            hits.push(fullKey);
        }
    }
    return hits;
}

const untranslated = walk(enData, jaData, '');
console.log('untranslated count: ' + untranslated.length);
for (const key of untranslated) {
    console.log('- ' + key);
}
