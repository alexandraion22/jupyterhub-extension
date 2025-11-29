import { test, expect } from '@jupyterlab/galata';

test('shows context menu only for root directories', async ({ page }) => {
  const fileBrowser = page.locator('[aria-label="File Browser Section"]');
  const rootFolder = `root-dir-${Date.now()}`;
  const nestedFolder = `nested-${Date.now()}`;

  const rightClickItem = async (label: string) => {
    await fileBrowser.getByText(label, { exact: true }).click({
      button: 'right'
    });
  };

  await page.getByRole('button', { name: 'New Folder' }).click();
  await page.locator('input.jp-DirListing-editor').fill(rootFolder);
  await page.locator('input.jp-DirListing-editor').press('Enter');
  await page.waitForTimeout(200);

  await rightClickItem(rootFolder);

  await page.getByRole('menuitem', { name: 'Example' }).click();
  await expect(page.getByText(new RegExp(`^Path: ${rootFolder}$`))).toHaveCount(
    1
  );
  await page.getByRole('button', { name: /ok/i }).click();

  await fileBrowser.getByText(rootFolder, { exact: true }).dblclick();
  await page.getByRole('button', { name: 'New Folder' }).click();
  await page.locator('input.jp-DirListing-editor').fill(nestedFolder);
  await page.locator('input.jp-DirListing-editor').press('Enter');
  await page.waitForTimeout(200);

  await rightClickItem(nestedFolder);

  await expect(page.getByRole('menuitem', { name: 'Example' })).toHaveCount(0);
  await page.keyboard.press('Escape');
});
