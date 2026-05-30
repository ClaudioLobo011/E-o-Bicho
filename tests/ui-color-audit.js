const fs = require('fs');
const path = require('path');

function loadPlaywright() {
  try {
    return require('playwright');
  } catch (error) {
    const os = require('os');
    const candidatesRoot = path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx');
    if (fs.existsSync(candidatesRoot)) {
      for (const entry of fs.readdirSync(candidatesRoot)) {
        const candidate = path.join(candidatesRoot, entry, 'node_modules', 'playwright');
        if (fs.existsSync(candidate)) return require(candidate);
      }
    }
    throw error;
  }
}

const { chromium } = loadPlaywright();

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = process.env.UI_AUDIT_BASE_URL || 'http://127.0.0.1:4173';

function listHtmlPages() {
  const pages = ['/index.html'];
  const pagesDir = path.join(ROOT, 'pages');

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        pages.push(`/${path.relative(ROOT, full).replace(/\\/g, '/')}`);
      }
    }
  }

  walk(pagesDir);
  return pages.sort();
}

async function auditPage(browser, route) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem('apiServerOverride', 'http://127.0.0.1:4173');
    localStorage.setItem('eobicho-admin-master-active', '1');
    localStorage.setItem(
      'loggedInUser',
      JSON.stringify({
        id: 'audit-user',
        _id: 'audit-user',
        token: 'audit-token',
        role: 'admin_master',
        name: 'Auditoria UI',
        email: 'auditoria@example.com',
      }),
    );
  });

  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173|localhost:4173).*/, (routeRequest) => {
    routeRequest.abort();
  });

  await page.route(/\/api\/auth\/check(?:\?|$)/, (routeRequest) => {
    routeRequest.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ role: 'admin_master', originalRole: 'admin_master' }),
    });
  });

  await page.route(/\/api(?:\/|\?|$)/, (routeRequest) => {
    const request = routeRequest.request();
    const body = request.method() === 'GET' ? '[]' : '{}';
    routeRequest.fulfill({ status: 200, contentType: 'application/json', body });
  });

  const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const status = response ? response.status() : 0;
  if (status >= 400) throw new Error(`HTTP ${status}`);
  await page.waitForTimeout(400);

  const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  if (!bodyText.trim()) throw new Error('body vazio');

  const contrastProblems = await page.evaluate(() => {
    function parseRgb(value) {
      if (!value || value === 'transparent') return null;
      const rgbMatch = value.match(/rgba?\(([^)]+)\)/);
      if (rgbMatch) {
        const parts = rgbMatch[1].split(',').map((part) => Number.parseFloat(part.trim()));
        if (parts.length < 3 || parts.some((part, index) => index < 3 && Number.isNaN(part))) return null;
        return { r: parts[0], g: parts[1], b: parts[2], a: parts.length >= 4 && !Number.isNaN(parts[3]) ? parts[3] : 1 };
      }
      const oklchMatch = value.match(/oklch\(\s*([0-9.]+)%?\s+([0-9.]+)\s+([0-9.]+)/);
      if (!oklchMatch) return null;
      const L = value.includes('%') ? Number(oklchMatch[1]) / 100 : Number(oklchMatch[1]);
      const C = Number(oklchMatch[2]);
      const H = Number(oklchMatch[3]) * (Math.PI / 180);
      const a = C * Math.cos(H);
      const b = C * Math.sin(H);
      const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
      const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
      const s_ = L - 0.0894841775 * a - 1.291485548 * b;
      const l = l_ ** 3;
      const m = m_ ** 3;
      const s = s_ ** 3;
      const linear = {
        r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
      };
      const gamma = (channel) => {
        const clamped = Math.min(1, Math.max(0, channel));
        return Math.round((clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055) * 255);
      };
      return { r: gamma(linear.r), g: gamma(linear.g), b: gamma(linear.b), a: 1 };
    }
    function luminance(rgb) {
      const channel = [rgb.r, rgb.g, rgb.b].map((value) => {
        const srgb = value / 255;
        return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channel[0] + 0.7152 * channel[1] + 0.0722 * channel[2];
    }
    function contrastRatio(foreground, background) {
      const fg = luminance(foreground);
      const bg = luminance(background);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    }
    function effectiveBackground(element) {
      let current = element;
      while (current && current !== document.documentElement) {
        const background = parseRgb(getComputedStyle(current).backgroundColor);
        if (background && background.a > 0.05) return background;
        current = current.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    }

    return [...document.querySelectorAll('button, [role="button"], a')]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const text = element.innerText || element.getAttribute('aria-label') || element.title || element.id || element.tagName;
        const foreground = parseRgb(getComputedStyle(element).color);
        const background = effectiveBackground(element);
        if (!foreground || !background) return null;
        return {
          text: String(text).trim().replace(/\s+/g, ' ').slice(0, 80),
          ratio: Number(contrastRatio(foreground, background).toFixed(2)),
        };
      })
      .filter(Boolean)
      .filter((item) => item.ratio < 3);
  });

  const controlHandles = await page.locator('button, [role="button"]').elementHandles();
  let totalControls = 0;
  const blockedControls = [];
  for (const handle of controlHandles) {
    const actionable = await handle.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const inViewport =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth;
      const hiddenByClass = element.closest('.hidden, [hidden], [aria-hidden="true"]');
      return style.visibility !== 'hidden' && style.display !== 'none' && inViewport && !hiddenByClass;
    });
    if (!actionable) continue;
    totalControls += 1;
    try {
      await handle.click({ trial: true, timeout: 600 });
    } catch (error) {
      const label = await handle.evaluate((element) => (element.innerText || element.getAttribute('aria-label') || element.id || element.tagName).trim());
      blockedControls.push({ label, error: error.message.split('\n')[0] });
    }
  }

  await context.close();

  return {
    route,
    controls: totalControls,
    blockedControls,
    contrastProblems,
    pageErrors,
    consoleErrors: consoleErrors.filter((message) => !message.includes('Failed to load resource')),
  };
}

async function main() {
  const browser = await chromium.launch();
  const routes = listHtmlPages();
  const results = [];
  const failures = [];

  for (const route of routes) {
    process.stdout.write(`auditando ${route}\n`);
    try {
      const result = await Promise.race([
        auditPage(browser, route),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout da auditoria da tela')), 12000)),
      ]);
      results.push(result);
      if (result.contrastProblems.length) {
        failures.push(result);
      }
    } catch (error) {
      failures.push({ route, fatal: error.message });
    }
  }

  await browser.close();

  const reportPath = path.join(ROOT, 'tests', 'ui-color-audit-report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify({ results, failures }, null, 2)}\n`);

  if (failures.length) {
    console.error(JSON.stringify(failures, null, 2));
    process.exit(1);
  }

  console.log(`OK: ${routes.length} telas auditadas. Relatorio: ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
