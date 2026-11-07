import { useCallback, useEffect, RefObject } from 'react';

/**
 * EXEC-DIR-2023-001 TASK 6 — POS keyboard focus lock.
 * Re-arms the barcode input whenever any modal/dialog closes.
 * Usage: const { rearm } = useAutoFocusBarcode(barcodeInputRef, deps);
 * Call rearm() in every modal onClose path.
 */
export function useAutoFocusBarcode(
  ref: RefObject<HTMLInputElement | null>,
  resetDeps: unknown[] = [],
) {
  const rearm = useCallback(() => {
    // requestAnimationFrame: wait for the modal unmount paint first.
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
  }, [ref]);

  // Re-arm when the dependency lane changes (modals open/close toggles).
  // F3/F6 fix: re-arm ONLY when every modal is closed. Firing on open stole
  // focus from the modal's own input (barcode field won the race, keystrokes
  // landed behind the modal). Note modal indexes are numbers — 0 is open.
  useEffect(() => {
    if (resetDeps.length === 0) return;
    const anyOpen = resetDeps.some(d => d !== null && d !== false && d !== undefined);
    if (anyOpen) return;
    rearm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetDeps);

  return { rearm };
}
