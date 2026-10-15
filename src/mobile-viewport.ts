/** iOS WebKit may ignore maximum-scale even in standalone PWA mode.
 * This cancels ONLY multi-touch browser zoom; one-finger scrolling and
 * deliberate horizontal scrolling in command lists continue to work.
 */
export function preventMobilePageZoom(target: Document = document): () => void {
  const blockGesture = (event: Event) => event.preventDefault();
  const blockTwoFingers = (event: TouchEvent) => {
    if (event.touches.length > 1) event.preventDefault();
  };
  target.addEventListener("gesturestart", blockGesture, { passive: false });
  target.addEventListener("gesturechange", blockGesture, { passive: false });
  target.addEventListener("touchmove", blockTwoFingers, { passive: false });
  return () => {
    target.removeEventListener("gesturestart", blockGesture);
    target.removeEventListener("gesturechange", blockGesture);
    target.removeEventListener("touchmove", blockTwoFingers);
  };
}
