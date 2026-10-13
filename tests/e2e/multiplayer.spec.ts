import fs from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, CDPSession, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * Race a Friend in two browsers (Milestone E): two phone-sized contexts with their own storage
 * and guest identity, one at 870 x 370 and one at 667 x 375, play the whole friend flow on the
 * production build against the real server: open a lobby, open the invite link in the other
 * context, watch the host change the track, build with the server's clock, race (the guest
 * drives part of it by touch), see the same result on both, rematch, and then lose the guest
 * mid-race, first for a moment (both see the reconnect, and the race goes on) and then for good
 * (a disconnect forfeit). The whole flow runs twice, with the two sizes swapped, so every
 * screen is captured at both.
 *
 * Both run with `?autopilot=1`, the page's own centerline driver, so a three-lap race finishes
 * without a scripted thumb; a touch on the screen takes over from it, as for a player.
 * Screenshots of every new screen go to docs/evidence/multiplayer.
 */

const EVIDENCE = path.resolve('docs/evidence/multiplayer');
const HOST = { width: 870, height: 370 };
const GUEST = { width: 667, height: 375 };

/** Page errors, and console errors except the ones a test causes on purpose. */
function collectProblems(page: Page): string[] & { expectFailedRequests: boolean } {
  const problems = Object.assign([] as string[], { expectFailedRequests: false });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // The join route answers 404 for a code with no lobby; that is the answer under test.
    if (/status of 404/.test(text)) return;
    // Reconnection attempts the test itself aborts while it holds the network down.
    if (problems.expectFailedRequests && /net::ERR_FAILED/.test(text)) return;
    problems.push(text);
  });
  page.on('pageerror', (e) => problems.push(e.message));
  return problems;
}

async function phone(
  browser: Browser,
  viewport: { width: number; height: number },
): Promise<[BrowserContext, Page]> {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  return [context, page];
}

async function shot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(EVIDENCE, `${name}_${size.width}x${size.height}.png`) });
}

/** One finger through CDP, so the race's floating stick sees a real touch. */
async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  holdMs: number,
) {
  const session: CDPSession = await page.context().newCDPSession(page);
  const point = (p: { x: number; y: number }) => [
    { x: p.x, y: p.y, id: 1, radiusX: 8, radiusY: 8, force: 1 },
  ];
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from) });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(to) });
  await page.waitForTimeout(holdMs);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: point(to) });
  await session.detach();
}

async function cell(page: Page, id: string): Promise<string> {
  return ((await page.getByTestId(id).textContent()) ?? '').trim();
}

for (const [hostSize, guestSize] of [
  [HOST, GUEST],
  [GUEST, HOST],
] as const)
  test(`two phones (host ${hostSize.width} x ${hostSize.height}): invite, build, race, same result, rematch, reconnect, forfeit`, async ({
    browser,
  }) => {
    test.setTimeout(600_000);
    const [hostContext, host] = await phone(browser, hostSize);
    const [guestContext, guest] = await phone(browser, guestSize);
    const hostProblems = collectProblems(host);
    const guestProblems = collectProblems(guest);

    // --- Lobby: the host opens it from Home.
    await host.goto('/?autopilot=1');
    await host.getByTestId('challenge-friend').tap();
    const codeEl = host.getByTestId('match-code');
    await expect(codeEl).toBeVisible();
    const code = (await codeEl.getAttribute('data-code'))!;
    expect(code).toMatch(/^[2-9A-HJKMNP-TV-Z]{6}$/);
    await expect(host.getByTestId('start-build')).toBeDisabled();
    await shot(host, 'lobby_host_waiting');

    // The invite link opens the lobby on the other phone, with the code already in it.
    await guest.goto(`/join/${code}?autopilot=1`);
    await expect(guest.getByTestId('lobby-screen')).toBeVisible();
    await expect(guest.getByTestId('match-code')).toHaveAttribute('data-code', code);
    await expect(guest.getByTestId('guest-status')).toHaveText('Ready to build');
    await expect(host.getByTestId('start-build')).toBeEnabled();
    // The host picks the track; the guest sees each change.
    const first = await cell(host, 'lobby-track');
    await host.getByTestId('next-track').tap();
    await expect(host.getByTestId('lobby-track')).not.toHaveText(first);
    const second = await cell(host, 'lobby-track');
    await expect(guest.getByTestId('lobby-track')).toHaveText(second);
    await host.getByRole('button', { name: 'Previous track' }).tap();
    await expect(guest.getByTestId('lobby-track')).toHaveText(first);
    await guest.waitForTimeout(2_500);
    await shot(host, 'lobby_host_full');
    await shot(guest, 'lobby_guest');

    // --- Track preview, then the build with the server's clock.
    await host.getByTestId('start-build').tap();
    await expect(host.getByTestId('build-your-car')).toBeVisible();
    await expect(guest.getByTestId('build-your-car')).toBeVisible();
    await shot(guest, 'reveal_guest');
    await host.getByTestId('build-your-car').tap();
    await shot(host, 'reveal_host_waiting');
    await guest.getByTestId('build-your-car').tap();
    await expect(host.getByTestId('ready')).toBeVisible({ timeout: 20_000 });
    await expect(guest.getByTestId('ready')).toBeVisible({ timeout: 20_000 });
    await expect(host.getByTestId('rival-build-status')).toHaveAttribute('data-ready', 'false');
    await shot(host, 'garage_match');
    await guest.getByTestId('ready').tap();
    await expect(host.getByTestId('rival-build-status')).toHaveAttribute('data-ready', 'true');
    await shot(guest, 'garage_waiting');
    await shot(host, 'garage_rival_ready');
    await host.getByTestId('ready').tap();

    // --- Race one. Both views come up; the guest drives a stretch by touch.
    await expect(host.locator('.hud')).toBeVisible({ timeout: 60_000 });
    await expect(guest.locator('.hud')).toBeVisible({ timeout: 60_000 });
    await host.waitForTimeout(6_000);
    await shot(host, 'race');
    await shot(guest, 'race');
    await drag(guest, { x: 330, y: 250 }, { x: 330, y: 205 }, 2_000);

    // Same race, same numbers, on both phones.
    await expect(host.getByTestId('results')).toBeVisible({ timeout: 360_000 });
    await expect(guest.getByTestId('results')).toBeVisible({ timeout: 30_000 });
    const outcomes = [
      await host.getByTestId('results').getAttribute('data-outcome'),
      await guest.getByTestId('results').getAttribute('data-outcome'),
    ].sort();
    expect(outcomes).toEqual(['defeat', 'victory']);
    for (const row of ['time', 'bestLap', 'laps', 'hull', 'dealt', 'hits']) {
      expect(await cell(host, `res-${row}-you`)).toBe(await cell(guest, `res-${row}-rival`));
      expect(await cell(host, `res-${row}-rival`)).toBe(await cell(guest, `res-${row}-you`));
    }
    await shot(host, 'results');
    await shot(guest, 'results');

    // --- Rematch: nothing starts until both have asked.
    await host.getByTestId('vote-race').tap();
    await expect(guest.getByTestId('vote-line')).toBeVisible();
    await shot(guest, 'results_rival_voted');
    await shot(host, 'results_voted');
    await guest.getByTestId('vote-race').tap();
    await expect(host.getByTestId('results')).toBeHidden({ timeout: 30_000 });
    await expect(host.locator('.hud')).toBeVisible({ timeout: 60_000 });
    await expect(guest.locator('.hud')).toBeVisible({ timeout: 60_000 });
    await host.waitForTimeout(5_000);

    // --- The guest's phone loses its signal for a moment: its own reconnect overlay, the
    // host's banner, then back in the race with nothing reset.
    guestProblems.expectFailedRequests = true;
    await guest.route('**/matchmake/reconnect/**', (route) => route.abort());
    await guest.evaluate(() =>
      (window as unknown as { __boltMatch?: { drop(): void } }).__boltMatch?.drop(),
    );
    await expect(guest.getByTestId('match-reconnecting')).toBeVisible({ timeout: 10_000 });
    await expect(host.getByTestId('rival-away')).toBeVisible({ timeout: 10_000 });
    await shot(guest, 'race_reconnecting');
    await shot(host, 'race_rival_away');
    await guest.unroute('**/matchmake/reconnect/**');
    guestProblems.expectFailedRequests = false;
    await expect(guest.getByTestId('match-reconnecting')).toBeHidden({ timeout: 15_000 });
    await expect(host.getByTestId('rival-away')).toBeHidden({ timeout: 10_000 });
    await expect(guest.locator('.hud')).toBeVisible();
    await guest.waitForTimeout(2_000);

    // --- Then the guest's phone goes away for good: autopilot, then a disconnect forfeit.
    await guestContext.close();
    // The away banner shows for the grace window; on a slow runner the results can already be
    // up by the time the host page is looked at, so either one proves the drop was seen.
    await expect
      .poll(
        async () =>
          (await host.getByTestId('rival-away').isVisible()) ||
          (await host.getByTestId('results').isVisible()),
        { timeout: 20_000 },
      )
      .toBe(true);
    await expect(host.getByTestId('results')).toBeVisible({ timeout: 40_000 });
    await expect(host.getByTestId('results')).toHaveAttribute('data-reason', 'rival_forfeit');
    await expect(host.getByTestId('results-line')).toHaveText(
      'Your rival disconnected. You win by forfeit.',
    );
    await expect(host.getByTestId('reopen')).toBeVisible({ timeout: 10_000 });
    await shot(host, 'results_forfeit');
    await host.getByTestId('match-home').tap();
    await expect(host.getByTestId('challenge-friend')).toBeVisible();

    expect([...hostProblems]).toEqual([]);
    expect([...guestProblems]).toEqual([]);
    await hostContext.close();
  });

test('a wrong or expired code gets the approved answer at both phone sizes', async ({
  browser,
}) => {
  for (const size of [HOST, GUEST]) {
    const [context, page] = await phone(browser, size);
    const problems = collectProblems(page);
    await page.goto('/');
    await page.getByTestId('join-with-code').tap();
    // Look-alike symbols are explained before anything is sent.
    await page.getByTestId('join-code').fill('k7m-0o');
    await expect(
      page.getByText('Codes never use O, I, L, U, 0 or 1. Check the code and try again.'),
    ).toBeVisible();
    await expect(page.getByTestId('join-go')).toBeDisabled();
    await shot(page, 'join_typing');
    // A well-formed code for no open lobby: the expired-invite copy, Back Home, Try Another Code.
    await page.getByTestId('join-code').fill('ZZZ-ZZZ');
    await page.getByTestId('join-go').tap();
    const error = page.getByTestId('join-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('This invite has expired. Ask your friend for a new link.');
    await expect(page.getByRole('button', { name: 'Back Home' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try Another Code' })).toBeVisible();
    await shot(page, 'join_expired');
    // An invite link for a lobby that is gone lands on the same answer.
    await page.goto('/join/ZZZZZZ');
    await expect(page.getByTestId('join-error')).toBeVisible();
    await page.getByRole('button', { name: 'Try Another Code' }).tap();
    await expect(page.getByTestId('join-code')).toBeVisible();
    expect(problems.filter((p) => !/status of 404/.test(p))).toEqual([]);
    await context.close();
  }
});
