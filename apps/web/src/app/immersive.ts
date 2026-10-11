/** Fullscreen and landscape are best-effort and only ever requested from a tap (Section 2). */
export async function enterImmersive(): Promise<void> {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    };
    await orientation.lock?.('landscape');
  } catch {
    // Unsupported or refused: the rotate prompt covers it.
  }
}
