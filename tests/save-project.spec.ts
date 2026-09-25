import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

test('Save project asks for a filename and keeps project name aligned with the download', async ({ page }) => {
  await page.locator('[data-menu="file-menu"]').click();
  await page.locator('#save-project').click();
  await expect(page.locator('#save-dialog')).toBeVisible();
  await expect(page.getByLabel('Project file name')).toHaveValue('Untitled scene');

  await page.getByLabel('Project file name').fill('Shot 010.forge');
  await expect(page.locator('#save-file-preview')).toHaveText('Shot 010.forge');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#confirm-save').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('Shot 010.forge');
  await expect(page.locator('#save-dialog')).toBeHidden();
  await expect(page.getByLabel('Project name')).toHaveValue('Shot 010');

  const path = await download.path();
  expect(path).not.toBeNull();
  const project = JSON.parse(await readFile(path!, 'utf8'));
  expect(project.name).toBe('Shot 010');
  expect(await page.evaluate(() => (window as any).__forge.name)).toBe('Shot 010');
});

test('Save filename normalization avoids duplicate extensions and unsafe Windows names', async ({ page }) => {
  await page.getByLabel('Project name').fill('Scene.forge.forge');
  await page.getByLabel('Project name').press('Tab');
  await expect(page.getByLabel('Project name')).toHaveValue('Scene');
  expect(await page.evaluate(() => (window as any).__forge.name)).toBe('Scene');

  await page.keyboard.press('Control+s');
  await expect(page.locator('#save-dialog')).toBeVisible();
  await expect(page.getByLabel('Project file name')).toHaveValue('Scene');

  await page.getByLabel('Project file name').fill('CON.forge');
  await expect(page.locator('#save-file-preview')).toHaveText('CON_.forge');
  await page.locator('#cancel-save').click();

  await expect(page.locator('#save-dialog')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__forge.name)).toBe('Scene');

  await page.keyboard.press('Control+s');
  await expect(page.locator('#save-dialog')).toBeVisible();
  await page.getByLabel('Project file name').fill('look/dev:*?.forge');
  await expect(page.locator('#save-file-preview')).toHaveText('look_dev___.forge');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#confirm-save').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('look_dev___.forge');
  expect(await page.evaluate(() => (window as any).__forge.name)).toBe('look_dev___');
});
