import fs from 'fs';
import { execSync } from 'child_process';
import { parse } from 'espree';

function collectRoutes(code) {
    const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', loc: false, range: true });
    const out = [];
    const walk = (node) => {
        if (!node || typeof node.type !== 'string') return;
        if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' &&
            node.callee.object?.name === 'app' && ['get','post','put','delete','patch'].includes(node.callee.property?.name)) {
            const a0 = node.arguments[0];
            if (a0?.type === 'Literal') out.push(`${node.callee.property.name} ${a0.value}`);
        }
        for (const [k, v] of Object.entries(node)) {
            if (['type','loc','range'].includes(k)) continue;
            if (Array.isArray(v)) v.forEach(walk);
            else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v);
        }
    };
    walk(ast);
    return out;
}

const orig = collectRoutes(execSync('git show HEAD:server/server.js', { encoding: 'utf8', maxBuffer: 50e6 }));
let now = collectRoutes(fs.readFileSync('server/server.js', 'utf8'));
for (const f of fs.readdirSync('server/routes')) {
    if (f.endsWith('.js')) now = now.concat(collectRoutes(fs.readFileSync(`server/routes/${f}`, 'utf8')));
}
const count = (arr) => arr.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
const co = count(orig), cn = count(now);
const missing = [], extra = [];
for (const k of new Set([...Object.keys(co), ...Object.keys(cn)])) {
    if ((co[k] || 0) > (cn[k] || 0)) missing.push(`${k} ×${co[k] - (cn[k] || 0)}`);
    if ((cn[k] || 0) > (co[k] || 0)) extra.push(`${k} ×${(cn[k] || 0) - (co[k] || 0)}`);
}
console.log(`原路由 ${orig.length}，拆后 ${now.length}`);
if (missing.length) console.log('缺失:\n' + missing.join('\n'));
if (extra.length) console.log('多出:\n' + extra.join('\n'));
if (!missing.length && !extra.length) console.log('✅ 路由多重集完全一致');
