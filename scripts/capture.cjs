/**
 * 页面截图脚本：为 PRD 文档自动捕获每个页面截图
 * 用法：node scripts/capture.cjs
 * 输出：docs/screenshots/*.png
 *
 * 关键修复：使用 addInitScript 在每个页面脚本执行前注入 localStorage，
 * 确保 React 挂载时 hydrate() 即可读取登录态，避免被路由守卫重定向到 /login
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:5174';
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots');

// 与 src/mock/seedData.ts / src/services/authService.ts 保持一致
const USERS = {
  purchaser: {
    id: 'U-PURCHASER',
    name: '李明',
    email: 'purchaser@qszk.com',
    role: 'purchaser',
    department: '采购部',
    position: '采购经理',
    avatarColor: '#1677ff',
  },
  legal: {
    id: 'U-LEGAL',
    name: '王律师',
    email: 'legal@qszk.com',
    role: 'legal',
    department: '法务部',
    position: '高级法务',
    avatarColor: '#13c2c2',
  },
  admin: {
    id: 'U-ADMIN',
    name: '张管理员',
    email: 'admin@qszk.com',
    role: 'admin',
    department: '信息技术部',
    position: '系统管理员',
    avatarColor: '#722ed1',
  },
};

const SCREENSHOTS = [
  { name: 'P01-登录页', path: '/login', auth: null, wait: 1500 },
  { name: 'P02-工作台', path: '/dashboard', auth: 'purchaser', wait: 2000 },
  { name: 'P03-审核列表', path: '/reviews', auth: 'purchaser', wait: 2000 },
  { name: 'P04-新建审核-上传', path: '/reviews/new', auth: 'purchaser', wait: 1500 },
  // P05 进度页：种子数据 RVT-DEMO-002 状态为 pending_legal（已完成），
  // 需先 goto 让 initDB 初始化，再通过 evaluate 修改 task 状态为 ai_reviewing + 注入 startMap，reload 后截图
  { name: 'P05-审核进度', path: '/reviews/RVT-DEMO-002/progress', auth: 'purchaser', wait: 1200, special: 'P05' },
  { name: 'P06-字段确认', path: '/reviews/RVT-DEMO-001/fields', auth: 'purchaser', wait: 1800 },
  { name: 'P07-审核详情三栏', path: '/reviews/RVT-DEMO-001', auth: 'purchaser', wait: 2500 },
  { name: 'P08-法务复核', path: '/legal-reviews/RVT-DEMO-003', auth: 'legal', wait: 2000 },
  { name: 'P09-报告列表', path: '/reports', auth: 'purchaser', wait: 1800 },
  { name: 'P10-报告详情', path: '/reports/RPT-DEMO-001', auth: 'purchaser', wait: 2500 },
  { name: 'P11-审核记录', path: '/reviews/RVT-DEMO-001/history', auth: 'purchaser', wait: 2000 },
  { name: 'P12-风险规则库', path: '/rules', auth: 'admin', wait: 2000 },
];

/**
 * 设置 context 的 initScript（在页面脚本执行前运行）
 * 注入登录态（qszk: 前缀）+ 额外 localStorage 项
 * 不清空 data:inited：每个 context 是全新的，initDB 首次加载时自动初始化；
 * 之后 reload 不会重新初始化，保留 page.evaluate 修改的数据
 */
async function setupInitScript(ctx, role, extraStorage = {}) {
  const user = role ? USERS[role] : null;
  await ctx.addInitScript((params) => {
    if (params.user) {
      try { localStorage.setItem('qszk:auth:currentUser', JSON.stringify(params.user)); } catch(e) {}
    } else {
      try { localStorage.removeItem('qszk:auth:currentUser'); } catch(e) {}
    }
    for (const [key, value] of Object.entries(params.extra)) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch(e) {}
    }
  }, { user, extra: extraStorage });
}

async function run() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });

  for (const item of SCREENSHOTS) {
    // 为每个截图创建独立 context，避免状态污染
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });

    // 关键：在页面任何脚本执行前注入 localStorage
    // extraStorage 支持函数（动态计算，如 P05 的 start 时间戳需在截图前才计算）
    const extra = typeof item.extraStorage === 'function' ? item.extraStorage() : (item.extraStorage || {});
    await setupInitScript(ctx, item.auth, extra);

    const page = await ctx.newPage();
    try {
      if (item.special === 'P05') {
        // P05 特殊处理：RVT-DEMO-002 种子状态为 pending_legal（已完成），需改为 ai_reviewing 才能截到进度页
        // 第一步：goto 进度页，让 initDB 初始化种子数据（使用 domcontentloaded 快速返回，避免进度页完成跳转）
        await page.goto(`${BASE}${item.path}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        // 第二步：修改 task 状态为 ai_reviewing + 注入 start 时间戳（4 秒前，让进度约 50%）
        await page.evaluate(() => {
          const tasks = JSON.parse(localStorage.getItem('qszk:data:tasks') || '[]');
          const updated = tasks.map((t) => {
            if (t.id === 'RVT-DEMO-002') {
              return { ...t, status: 'ai_reviewing', progress: 0, currentStage: 'parse' };
            }
            return t;
          });
          localStorage.setItem('qszk:data:tasks', JSON.stringify(updated));
          // 注入 start 时间戳（4 秒前）
          localStorage.setItem('qszk:data:reviewStarts', JSON.stringify({ 'RVT-DEMO-002': Date.now() - 4000 }));
        });
        // 第三步：reload 进度页，此时 initDB 不会重新初始化（data:inited = true），task 状态保持 ai_reviewing
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
        // 等待进度页渲染 + getProgress 调用
        await page.waitForTimeout(item.wait);
        const file = path.join(OUT_DIR, `${item.name}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log(`✓ ${item.name} -> ${file}  (URL: ${page.url()})`);
      } else {
        // 标准截图流程
        await page.goto(`${BASE}${item.path}`, { waitUntil: 'networkidle', timeout: 20000 });
        await page.waitForTimeout(item.wait);
        const currentUrl = page.url();
        if (item.auth && currentUrl.includes('/login')) {
          console.warn(`⚠ ${item.name} 被重定向到登录页（登录态注入失败）`);
        }
        const file = path.join(OUT_DIR, `${item.name}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log(`✓ ${item.name} -> ${file}  (URL: ${currentUrl})`);
      }
    } catch (e) {
      console.error(`✗ ${item.name} failed:`, e.message);
      try {
        const file = path.join(OUT_DIR, `${item.name}-error.png`);
        await page.screenshot({ path: file, fullPage: true });
      } catch (_) {}
    } finally {
      await ctx.close();
    }
  }

  await browser.close();
  console.log('\n截图全部完成，输出目录：', OUT_DIR);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
