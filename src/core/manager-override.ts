/**
 * Baraka Market — POS security interceptor bridge (ADR-014-MKT).
 * Declares which cashier actions are gated behind the manager PIN and
 * builds the audit payload the UI / API must log once approved.
 *
 * @module core/manager-override
 */
import type { ProtectedActionType, VoidLogEntry } from '../types/index.js';

/** Every sensitive action requires a manager override — no silent lane. */
export const PROTECTED_ACTIONS: ReadonlyArray<ProtectedActionType> = [
  'LINE_VOID', 'CART_CLEAR', 'MANUAL_DISCOUNT', 'DRAWER_KICK',
];

export function requiresOverride(action: ProtectedActionType): boolean {
  return (PROTECTED_ACTIONS as ReadonlyArray<string>).includes(action);
}

export interface OverrideRequest {
  action: ProtectedActionType;
  productId?: number;
  productName?: string;
  amountCt: number;
  cashierName: string;
  reason: string;
  sessionId?: string;
  managerApprovedBy?: string;
}

/** Validate the request shape; returns the auditable void-log entry. Throws on bad input. */
export function buildVoidLogEntry(req: OverrideRequest): VoidLogEntry {
  if (!requiresOverride(req.action)) {
    throw new Error(`[override] unknown protected action: ${req.action}`);
  }
  if (!Number.isInteger(req.amountCt) || req.amountCt < 0) {
    throw new Error('[override] amountCt must be a non-negative integer');
  }
  if (!req.cashierName?.trim()) throw new Error('[override] cashierName is required');
  if (!req.reason?.trim()) throw new Error('[override] reason is required');
  return {
    actionType: req.action,
    productId: req.productId,
    productName: req.productName,
    amountCt: req.amountCt,
    cashierName: req.cashierName.trim(),
    managerApprovedBy: req.managerApprovedBy?.trim() || undefined,
    reason: req.reason.trim(),
    sessionId: req.sessionId,
  };
}
