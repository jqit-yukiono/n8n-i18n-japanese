// List keys whose ja value still equals the en value (likely untranslated).
const fs = require('node:fs');
const path = require('node:path');

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

function run() {
    const enPath = path.join(__dirname, 'en.json');
    const jaPath = path.join(__dirname, '..', 'languages', 'ja.json');

    const enData = JSON.parse(fs.readFileSync(enPath, 'utf8'));
    const jaData = JSON.parse(fs.readFileSync(jaPath, 'utf8'));

    const untranslated = walk(enData, jaData, '');
    console.log('untranslated count: ' + untranslated.length);
    for (const key of untranslated) {
        console.log('- ' + key);
    }
}

module.exports = { walk, run };

if (require.main === module) {
    run();
}
