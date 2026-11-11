import type { ClaimReasonCode, ClaimResolution, ReturnDisposition, ReturnReasonCode, ReturnStatus } from '../../types/index';

/**
 * MKT-006 shared labels/helpers for the return desk islands.
 * Labels stay co-located with the desk (were inline in ReturnsView).
 */
export const REASON_LABEL: Record<ReturnReasonCode, { ar: string; fr: string }> = {
  DEFECT: { ar: 'عيب مصنعي', fr: 'Défaut' },
  WRONG_ITEM: { ar: 'صنف خاطئ', fr: 'Mauvais article' },
  SIZE_FIT: { ar: 'مقاس / حجم', fr: 'Taille' },
  EXPIRED: { ar: 'منتهي الصلاحية', fr: 'Expiré' },
  CHANGED_MIND: { ar: 'عدول الزبون', fr: 'Avis changé' },
  OTHER: { ar: 'أخرى', fr: 'Autre' },
};

export const STATUS_LABEL: Record<ReturnStatus, { ar: string; fr: string }> = {
  DRAFT: { ar: 'مسودة', fr: 'Brouillon' },
  APPROVED: { ar: 'مقبول', fr: 'Approuvé' },
  REJECTED: { ar: 'مرفوض', fr: 'Rejeté' },
};

export const DISP_LABEL: Record<ReturnDisposition, { ar: string; fr: string }> = {
  RESTOCK: { ar: 'إعادة للرف', fr: 'Remise en rayon' },
  QUARANTINE: { ar: 'حجر (للمندوب)', fr: 'Quarantaine (représentant)' },
  DESTROY: { ar: 'إتلاف', fr: 'Destruction' },
};

export const CLAIM_REASON_LABEL: Record<ClaimReasonCode, { ar: string; fr: string }> = {
  DEFECT: { ar: 'عيب مصنعي', fr: 'Défaut' },
  EXPIRED: { ar: 'منتهي الصلاحية', fr: 'Expiré' },
  WRONG_DELIVERY: { ar: 'تسليم خاطئ', fr: 'Mauvaise livraison' },
  SHORTAGE: { ar: 'نقص في الكمية', fr: 'Manquant' },
  OTHER: { ar: 'أخرى', fr: 'Autre' },
};

export const CLAIM_RES_LABEL: Record<ClaimResolution, { ar: string; fr: string }> = {
  CREDIT_NOTE: { ar: 'إشعار دائن (avoir)', fr: 'Avoir' },
  REPLACED: { ar: 'استبدال', fr: 'Échange' },
  REFUNDED: { ar: 'استرجاع نقدي', fr: 'Remboursé' },
  REJECTED: { ar: 'رفض المورّد', fr: 'Refus fournisseur' },
};

/** Milli-units → cashier-facing quantity (verbatim from ReturnsView). */
export const fmtUnitQty = (milli: number, unit: string): string =>
  unit === 'PIECE' ? String(milli / 1000) : unit === 'KG' ? `${milli} غ` : `${milli} مل`;
