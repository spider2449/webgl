import { test, expect } from '@playwright/test';

async function contrastRatio(page: any, foregroundSelector: string, backgroundSelector: string) {
  return page.evaluate(({ foregroundSelector, backgroundSelector }) => {
    const parse = (value: string) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) throw new Error(`Unsupported color: ${value}`);
      return match[1].split(',').slice(0, 3).map(part => Number(part.trim()));
    };
    const luminance = (rgb: number[]) => {
      const linear = rgb.map(channel => {
        const s = channel / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const foreground = document.querySelector(foregroundSelector)!;
    const background = document.querySelector(backgroundSelector)!;
    const fg = luminance(parse(getComputedStyle(foreground).color));
    const bg = luminance(parse(getComputedStyle(background).backgroundColor));
    const lighter = Math.max(fg, bg);
    const darker = Math.min(fg, bg);
    return (lighter + 0.05) / (darker + 0.05);
  }, { foregroundSelector, backgroundSelector });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('forge-theme'));
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

test('theme toggle switches between Dark and Light and persists across reload', async ({ page }) => {
  const root = page.locator('html');
  const toggle = page.getByRole('button', { name: 'Switch to light theme' });

  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await toggle.click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('forge-theme'))).toBe('light');

  await page.reload();
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('forge-theme'))).toBe('dark');
});

test('Dark and Light themes keep small editor text readable', async ({ page }) => {
  await page.getByRole('button', { name: 'Animation', exact: true }).click();

  const checks: Array<[string, string]> = [
    ['#animation-graph-detail', '.animation-graph-header'],
    ['.graph-channel-group button > small', '.graph-channel-group button'],
    ['.timeline-key-toolbar-hint', '.timeline-key-toolbar'],
    ['#scene-stats', '.statusbar'],
  ];

  for (const [foreground, background] of checks) {
    expect(await contrastRatio(page, foreground, background), `dark contrast for ${foreground}`).toBeGreaterThanOrEqual(4.5);
  }

  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  for (const [foreground, background] of checks) {
    expect(await contrastRatio(page, foreground, background), `light contrast for ${foreground}`).toBeGreaterThanOrEqual(4.5);
  }
});

test('Light theme applies to app chrome, Graph Editor, Timeline, sidebar and status bar', async ({ page }) => {
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to light theme' }).click();

  const backgrounds = await page.evaluate(() => {
    const selectors = ['.topbar', '.workspace-bar', '.animation-graph-header', '#animation-graph', '.timeline', '.sidebar', '.statusbar'];
    const parse = (value: string) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return [0, 0, 0];
      return match[1].split(',').slice(0, 3).map(part => Number(part.trim()));
    };
    return Object.fromEntries(selectors.map(selector => {
      const element = document.querySelector(selector)!;
      const rgb = parse(getComputedStyle(element).backgroundColor);
      return [selector, rgb.reduce((sum, value) => sum + value, 0) / 3];
    }));
  });

  for (const [selector, average] of Object.entries(backgrounds)) {
    expect(average, `${selector} should use a light surface`).toBeGreaterThan(200);
  }
});
