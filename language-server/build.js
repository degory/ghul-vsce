'use strict';

// Assembles the standalone language server package from the webpack bundle
// the extension build already produces. Run after `npm run webpack`.

const { copyFileSync, existsSync, mkdirSync, rmSync } = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bundle = path.join(root, 'server', 'out', 'server.js');
const out = path.join(__dirname, 'out');

if (!existsSync(bundle)) {
    console.error(`${bundle} not found: run 'npm run webpack' first`);
    process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

copyFileSync(bundle, path.join(out, 'server.js'));

const map = `${bundle}.map`;

if (existsSync(map)) {
    copyFileSync(map, path.join(out, 'server.js.map'));
}

copyFileSync(path.join(root, 'LICENSE'), path.join(__dirname, 'LICENSE'));

console.log(`packaged language server from ${bundle}`);
