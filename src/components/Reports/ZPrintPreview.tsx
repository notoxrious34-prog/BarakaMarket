import React, { memo } from 'react';
import type { StoreProfile } from '../../types';
import { APP_VERSION } from '../../core/version';

/**
 * ZPrintPreview.tsx — MKT-009 (U2: isolate the print preview).
 *
 * Verbatim extraction of the right column of DailyZReportView: 80mm
 * ESC/POS ticket or A4 audit sheet. Zero behaviour change — the view only
 * passes ticket values (live aggregates or a stored DAY row for reprint).
 */

/** Money in centimes, as printed on the Z ticket. */
export interface ZTicketValues {
  salesCount: number; ht: number; b0: number; b9: number; a9: number;
  b19: number; a19: number; tva: number; timbre: number; ttc: number;
  esp: number; bank: number; cred: number; coll: number;
  first: string; last: string;
}

interface Props {
  format: '80mm' | 'A4';
  isAr: boolean;
  tv: ZTicketValues;
  tvReportNo: string;
  tvClosedAt: string;
  closed: boolean;
  chainHash: string;
  prevHash: string;
  closeNote: string;
  viewDate: string;
  storeProfile: StoreProfile;
}

const shortHash = (h: string): string => `${h.slice(0, 10)}…${h.slice(-6)}`;

export const ZPrintPreview: React.FC<Props> = memo(function ZPrintPreview({
  format, isAr, tv, tvReportNo, tvClosedAt, closed,
  chainHash, prevHash, closeNote, viewDate, storeProfile,
}: Props) {
  return (
    <div className={`w-full ${format === 'A4' ? 'lg:flex-1' : 'lg:w-80'} flex flex-col items-center`}>
      <span className="text-xs font-semibold text-slate-400 mb-2">
        {format === 'A4'
          ? (isAr ? 'ورقة التدقيق A4' : 'Feuille d\'audit A4')
          : (isAr ? 'معاينة وصل الإغلاق (Ticket Z 80mm)' : 'Ticket Z ESC/POS 80mm')}
      </span>

      {format === 'A4' ? (
      <div
        id="printable-facture-a4"
        dir="ltr"
        className="w-full max-w-[640px] bg-white text-black p-8 font-mono text-xs leading-relaxed shadow-2xl border border-slate-300 select-text text-start"
        style={{ fontFamily: "'Courier New', Courier, monospace" }}
      >
        <div className="text-center border-b-2 border-black pb-3">
          <div className="font-bold text-lg uppercase">{storeProfile.store_name}</div>
          <div className="text-xs">{storeProfile.company_owner} — {storeProfile.address}</div>
          <div className="text-[11px]">RC: {storeProfile.rc_number} | NIF: {storeProfile.nif_number} | NIS: {storeProfile.nis_number} | AI: {storeProfile.ai_number}</div>
          <div className="font-bold mt-2">RAPPORT Z DE CLÔTURE — {tvReportNo}{closed && ' (FINALISÉ)'}</div>
          {!closed && (
            <div className="text-[11px] font-bold">— PROVISOIRE / غير نهائي —</div>
          )}
          <div className="text-[11px]">Date: {viewDate} — Clôture: {tvClosedAt} — Ventes: {tv.salesCount}</div>
          <div className="text-[11px]">Factures: {tv.first} → {tv.last}</div>
          </div>
          <table className="w-full my-3 text-[11px]">
            <tbody>
              <tr className="border-b border-black"><td>Total HT</td><td className="text-end">{(tv.ht / 100).toFixed(2)} DZD</td></tr>
              <tr className="border-b border-black"><td>TVA 0% — base</td><td className="text-end">{(tv.b0 / 100).toFixed(2)} DZD</td></tr>
              <tr className="border-b border-black"><td>TVA 9% — base / montant</td><td className="text-end">{(tv.b9 / 100).toFixed(2)} / {(tv.a9 / 100).toFixed(2)} DZD</td></tr>
              <tr className="border-b border-black"><td>TVA 19% — base / montant</td><td className="text-end">{(tv.b19 / 100).toFixed(2)} / {(tv.a19 / 100).toFixed(2)} DZD</td></tr>
              <tr className="border-b border-black"><td>Total TVA</td><td className="text-end">{(tv.tva / 100).toFixed(2)} DZD</td></tr>
              <tr className="border-b border-black"><td>Timbre fiscal (Art. 136)</td><td className="text-end">{(tv.timbre / 100).toFixed(2)} DZD</td></tr>
              <tr className="font-bold"><td>TOTAL TTC</td><td className="text-end">{(tv.ttc / 100).toFixed(2)} DZD</td></tr>
            </tbody>
          </table>
          <table className="w-full my-3 text-[11px]">
            <tbody>
              <tr className="border-b border-black"><td>Espèces (timbre inclus)</td><td className="text-end">{(tv.esp / 100).toFixed(2)} DZD</td></tr>
              <tr className="border-b border-black"><td>CIB / Dahabiya</td><td className="text-end">{(tv.bank / 100).toFixed(2)} DZD</td></tr>
              <tr className="border-b border-black"><td>Crédit accordé</td><td className="text-end">{(tv.cred / 100).toFixed(2)} DZD</td></tr>
              <tr className="border-b border-black"><td>Crédit recouvré</td><td className="text-end">{(tv.coll / 100).toFixed(2)} DZD</td></tr>
            </tbody>
          </table>
        <div className="text-[10px] break-all border-t border-black pt-2">
          <div>prev_hash: {prevHash}</div>
          <div className="font-bold">hash: {chainHash}</div>
          {closeNote && <div>{closeNote}</div>}
        </div>
        <div className="grid grid-cols-2 gap-8 mt-8 text-[11px]">
          <div className="border-t border-black pt-1 text-center">Signature caissier</div>
          <div className="border-t border-black pt-1 text-center">Signature gérant + cachet</div>
        </div>
      </div>
      ) : (
      <div
        id="printable-receipt"
        dir="ltr"
        className="w-full max-w-[300px] bg-white text-black p-4 font-mono text-[11px] leading-tight shadow-2xl border border-slate-300 select-text text-start"
        style={{ fontFamily: "'Courier New', Courier, monospace" }}
      >
        <div className="text-center space-y-0.5 border-b border-black pb-2">
          <div className="font-bold text-sm tracking-wider uppercase">{storeProfile.store_name}</div>
          <div className="font-semibold text-xs">{storeProfile.company_owner}</div>
          <div className="text-[10px]">{storeProfile.address}</div>
          <div className="text-[9.5px]">RC: {storeProfile.rc_number} | NIF: {storeProfile.nif_number}</div>
          <div className="text-[9.5px]">NIS: {storeProfile.nis_number} | AI: {storeProfile.ai_number}</div>
        </div>

        <div className="py-2 border-b border-black text-center">
          <div className="font-bold text-sm uppercase">*** RAPPORT Z DE CAISSE ***</div>
          <div className="text-[10px]">CLÔTURE JOURNALIÈRE FISCALE</div>
          {!closed && (
            <div className="text-[10px] font-bold">— PROVISOIRE / غير نهائي —</div>
          )}
          <div className="text-[10px] pt-1">
            {tvReportNo}{closed && ' — FINALISÉ'}
          </div>
          <div className="text-[10px]">
            Date: {viewDate} - Heure: {tvClosedAt}
          </div>
          <div className="text-[9px] break-words">
            {tv.first} → {tv.last}
          </div>
          {closeNote && <div className="text-[9px] font-bold">{closeNote}</div>}
        </div>

        <div className="py-2 border-b border-black space-y-1 text-[10px]">
          <div className="flex justify-between">
            <span>Nombre de Ventes:</span>
            <span className="font-bold">{tv.salesCount}</span>
          </div>
          <div className="flex justify-between">
            <span>Total HT:</span>
            <span>{(tv.ht / 100).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>TVA 9% (Base {(tv.b9 / 100).toFixed(2)}):</span>
            <span>{(tv.a9 / 100).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>TVA 19% (Base {(tv.b19 / 100).toFixed(2)}):</span>
            <span>{(tv.a19 / 100).toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Timbre Fiscal (Espèces):</span>
            <span>{(tv.timbre / 100).toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-black text-xs pt-1 border-t border-black">
            <span>TOTAL TTC:</span>
            <span>{(tv.ttc / 100).toFixed(2)} DZD</span>
          </div>
        </div>

        <div className="py-2 border-b border-black space-y-1 text-[10px]">
          <div className="font-bold uppercase pb-0.5">Ventilation des Paiements:</div>
          <div className="flex justify-between">
            <span>Espèces:</span>
            <span>{(tv.esp / 100).toFixed(2)} DZD</span>
          </div>
          <div className="flex justify-between">
            <span>CIB / Dahabiya:</span>
            <span>{(tv.bank / 100).toFixed(2)} DZD</span>
          </div>
          <div className="flex justify-between">
            <span>Crédit Client (Carnet):</span>
            <span>{(tv.cred / 100).toFixed(2)} DZD</span>
          </div>
          <div className="flex justify-between">
            <span>Règlements Crédits Reçus:</span>
            <span>{(tv.coll / 100).toFixed(2)} DZD</span>
          </div>
        </div>

        <div className="py-2 border-b border-black space-y-1 text-[10px]">
          <div className="font-bold uppercase pb-0.5">Chaîne Fiscale (SHA-256):</div>
          <div className="break-all">prev: {shortHash(prevHash)}</div>
          <div className="break-all font-bold">hash: {shortHash(chainHash)}</div>
        </div>

        <div className="text-center pt-2 space-y-0.5 text-[9px] text-slate-700">
          <div>Signé par le Caissier & Gérant</div>
          <div className="font-semibold text-slate-500 pt-1">Baraka Market v{APP_VERSION} by BarakaDEV</div>
        </div>
      </div>
      )}
    </div>
  );
});
