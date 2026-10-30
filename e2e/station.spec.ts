import { test, expect } from '@playwright/test';

test('a worker scans card and delivery notes at a station and sees colour feedback', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/stanica/1');
  const input = page.locator('#scan');
  await expect(input).toBeFocused();

  const scan = async (code: string): Promise<void> => {
    await page.keyboard.type(code);
    await page.keyboard.press('Enter');
  };
  await scan('Z0001');
  await expect(page.locator('#worker')).toHaveText('Ján Testovací');
  await expect(page.locator('#activity')).toHaveText('Balenie');

  await scan('DL-E2E-1');
  await expect(page.locator('#status')).toHaveClass(/\bok\b/);
  await expect(page.locator('#dl')).toHaveText('DL-E2E-1');
  await expect(page.locator('#customer')).toHaveText('Odberateľ DL-E2E-1');

  await scan('NEZNAMY-DL');
  await expect(page.locator('#status')).toHaveClass(/\bchyba\b/);
  await expect(page.locator('#dl')).toHaveText('DL-E2E-1');

  await scan('Z0002');
  await scan('DL-E2E-1');
  await expect(page.locator('#status')).toHaveClass(/\bupozornenie\b/);
  await expect(page.locator('#others')).toContainText('Ján Testovací');

  // After sign-out nobody is current: the next worker must scan their card first.
  await scan('C-ODHLAS');
  await expect(page.locator('#worker')).toHaveText('—');
  await expect(page.locator('#others')).toContainText('Ján Testovací');
  expect(errors).toEqual([]);
});

test('the start page lists the station with who is working', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('main h1')).toHaveText('Stanice');
  await expect(page.getByText('Baliaci stôl E2E')).toBeVisible();
});
