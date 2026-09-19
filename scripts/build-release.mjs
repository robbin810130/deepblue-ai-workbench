#!/usr/bin/env node
/**
 * 深蓝工作台 · 发行包构建脚本（appliance 升级包）
 *
 * 产物：release/deepblue-release-<version>.tar.gz
 * 包结构：
 *   deepblue-workbench/
 *     server/            服务端源码（排除 test_ 与 check_ 开头杂物）
 *     dist/              前端构建产物（vite outDir: dist.next-release）
 *     node_modules/      生产依赖（npm ci --omit=dev，package-lock 锁定）
 *     migrations/        本版 DDL（随包参考；真实迁移由 runInitDDL 启动期幂等执行）
 *     scripts/           交付自检脚本
 *     runtime.sh         启停脚本
 *     upgrade.sh         升级脚本
 *     manifest.json      版本清单
 *     package.json / package-lock.json / .env.example / CHANGELOG.md(可选)
 *
 * 用法：
 *   node scripts/build-release.mjs [--version 1.2.0] [--skip-build] [--out <dir>]
 *
 * 纪律：不引入独立迁移框架；schema 变更一律幂等（IF NOT EXISTS / ON CONFLICT），
 *       由 server.js runInitDDL 在启动期吃掉。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- args ----------
const args = process.argv.slice(2);
function argOf(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const SKIP_BUILD = args.includes('--skip-build');
const OUT_DIR = path.resolve(ROOT, argOf('--out') || 'release');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const LOCK_SHA = crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(ROOT, 'package-lock.json')))
  .digest('hex').slice(0, 12);

// ---------- version ----------
const shortSha = (() => {
  try { return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); }
  catch { return 'nogit'; }
})();
const dirty = (() => {
  try { return execSync('git status --porcelain', { cwd: ROOT }).toString().trim().length > 0; }
  catch { return false; }
})();
let VERSION = argOf('--version');
if (!VERSION) {
  VERSION = PKG.version && PKG.version !== '0.0.0'
    ? PKG.version
    : `dev-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
}

const log = (...m) => console.log('[build-release]', ...m);

// ---------- 1. 前端构建 ----------
if (!SKIP_BUILD) {
  log('npm run build（tsc -b && vite build）...');
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
}
const FE_DIR = path.join(ROOT, 'dist.next-release');
if (!fs.existsSync(path.join(FE_DIR, 'index.html'))) {
  console.error('[build-release] FATAL: dist.next-release/index.html 不存在，前端构建失败或未执行');
  process.exit(1);
}

// ---------- 2. 组装 stage ----------
const STAGE_ROOT = path.join(ROOT, '.release-stage');
const STAGE = path.join(STAGE_ROOT, 'deepblue-workbench');
fs.rmSync(STAGE_ROOT, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

// 2a. server/ —— 排除顶层杂物（核心代码已验证零引用）
const SERVER_EXCLUDE = [/^test_/, /^check_/, /^rebuild_/, /\.log$/, /^test_upload\.txt$/];
fs.cpSync(path.join(ROOT, 'server'), path.join(STAGE, 'server'), {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(path.join(ROOT, 'server'), src);
    if (!rel || rel.includes('..')) return true;               // 根目录与外部引用放行
    if (rel.split(path.sep).length === 1 && SERVER_EXCLUDE.some((re) => re.test(rel))) {
      log('  排除 server 杂物:', rel);
      return false;
    }
    return true;
  },
});

// 2b. dist/
fs.cpSync(FE_DIR, path.join(STAGE, 'dist'), { recursive: true });

// 2c. node_modules/ —— npm ci --omit=dev，按 package-lock sha 缓存
const CACHE = path.join(ROOT, '.release-cache', `nm-${LOCK_SHA}`);
if (!fs.existsSync(path.join(CACHE, 'node_modules', '.package-lock.json'))) {
  log('npm ci --omit=dev（缓存未命中', LOCK_SHA, '）...');
  fs.rmSync(CACHE, { recursive: true, force: true });
  fs.mkdirSync(CACHE, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(CACHE, 'package.json'));
  fs.copyFileSync(path.join(ROOT, 'package-lock.json'), path.join(CACHE, 'package-lock.json'));
  execSync('npm ci --omit=dev --no-audit --no-fund --ignore-scripts', { cwd: CACHE, stdio: 'inherit' });
} else {
  log('node_modules 缓存命中:', LOCK_SHA);
}
fs.cpSync(path.join(CACHE, 'node_modules'), path.join(STAGE, 'node_modules'), { recursive: true });

// 2d. 顶层文件
fs.mkdirSync(path.join(STAGE, 'scripts'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'scripts', 'check-appliance-readiness.js'),
  path.join(STAGE, 'scripts', 'check-appliance-readiness.js'));
for (const f of ['runtime.sh', 'upgrade.sh', '.env.example', 'package.json', 'package-lock.json']) {
  const src = path.join(ROOT, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(STAGE, f));
}
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
if (fs.existsSync(CHANGELOG)) fs.copyFileSync(CHANGELOG, path.join(STAGE, 'CHANGELOG.md'));

// 2e. manifest.json
fs.writeFileSync(path.join(STAGE, 'manifest.json'), JSON.stringify({
  name: 'deepblue-workbench',
  version: VERSION,
  commit: shortSha,
  dirty,
  builtAt: new Date().toISOString(),
  nodeMin: '18',
  entry: 'server/server.js',
  healthPath: '/api/health',
  lockSha: LOCK_SHA,
}, null, 2) + '\n');

// ---------- 3. tar.gz ----------
fs.mkdirSync(OUT_DIR, { recursive: true });
const tarName = `deepblue-release-${VERSION}.tar.gz`;
const tarPath = path.join(OUT_DIR, tarName);
fs.rmSync(tarPath, { force: true });
log('打包', tarName, '...');
execSync(`tar -czf "${tarPath}" -C "${STAGE_ROOT}" deepblue-workbench`, {
  cwd: ROOT, stdio: 'inherit',
  env: { ...process.env, COPYFILE_DISABLE: '1' },   // mac bsdtar 不写 AppleDouble
});

const sha = crypto.createHash('sha256').update(fs.readFileSync(tarPath)).digest('hex');
const sizeMB = (fs.statSync(tarPath).size / 1024 / 1024).toFixed(1);
fs.writeFileSync(tarPath + '.sha256', `${sha}  ${tarName}\n`);

log('════════════════════════════════════════');
log(`版本      : ${VERSION}${dirty ? '  ⚠️ 工作区有未提交改动' : ''}`);
log(`commit    : ${shortSha}`);
log(`包        : ${tarPath}`);
log(`大小      : ${sizeMB} MB`);
log(`sha256    : ${sha}`);
log('升级方式  : 现场解包后执行 ./upgrade.sh --package <本包路径>');
log('════════════════════════════════════════');
