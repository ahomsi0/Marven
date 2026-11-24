// Keeping a dropdown menu on screen: as wide as `maxWidth` allows within the
// window, and moved toward the start side by however much it would overflow
// the far edge. Used by the model picker, whose 420 px menu was clipped when
// the Agent panel was narrow.

export const MENU_MARGIN = 8;

export function fitMenu(
  trigger: { left: number; right: number },
  viewportWidth: number,
  maxWidth: number,
  rtl = false,
): { width: number; shift: number } {
  const width = Math.max(0, Math.min(maxWidth, viewportWidth - MENU_MARGIN * 2));
  const room = rtl ? trigger.right - MENU_MARGIN : viewportWidth - MENU_MARGIN - trigger.left;
  const startEdge = rtl ? viewportWidth - trigger.right : trigger.left;
  const shift = Math.min(Math.max(0, width - room), Math.max(0, startEdge - MENU_MARGIN));
  return { width, shift };
}
