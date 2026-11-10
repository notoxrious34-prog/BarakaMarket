import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Client, PaymentMethod } from '../../types';
import { formatDZD } from '../../core/display';
import { cashChime } from '../../hardware/sound';
import { kickDrawerViaLoopback } from '../../core/fiscal-authority';
import { ClientAccountStatement } from './ClientAccountStatement';
import { ceilingBar, CEILING_TONE_CLASS } from '../../core/ceiling-bar';
import {
  BookOpen,
  UserPlus,
  Search,
  DollarSign,
  Phone,
  MapPin,
  Clock,
  CheckCircle,
  AlertTriangle,
  Receipt,
  ArrowDownLeft,
  FileText,
  X,
  CreditCard,
  Banknote,
  Pencil,
  Trash2,
} from 'lucide-react';

export const CarnetDetteView: React.FC = () => {
  const { clients, sales, settlements, addClient, updateClient, deleteClient, settleClientDebt, language } = useApp();
  const isAr = language === 'ar';

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client>(clients[1] || clients[0]);
  // QA-P1: the selection state is only an identity holder — ALWAYS render the
  // live row from `clients` (settle/edit update the store, never this snapshot).
  const liveSelected = clients.find(c => c.id === selectedClient?.id) ?? selectedClient;
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [showSettlementModal, setShowSettlementModal] = useState(false);

  // Form for settlement
  const [settlementAmount, setSettlementAmount] = useState<number>(0);
  const [settlementMethod, setSettlementMethod] = useState<PaymentMethod>('ESPECES');
  const [settlementNote, setSettlementNote] = useState('');
  // D4-fix: settlement failures surface in-modal (login / overpay / lane).
  const [settleError, setSettleError] = useState('');
  // D6/D7-fix: client create/edit guard failures surface in-modal.
  const [clientFormMsg, setClientFormMsg] = useState('');
  const [showStatement, setShowStatement] = useState(false);

  // Form for new client
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientAddress, setNewClientAddress] = useState('');
  const [newClientLimit, setNewClientLimit] = useState(20000);
  const [newClientNif, setNewClientNif] = useState('');

  // BRK-020: client edit/delete lifecycle.
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [crudMsg, setCrudMsg] = useState('');
  const handleDeleteClient = (client: Client) => {
    if (client.credit_balance > 0) {
      setCrudMsg(isAr
        ? `مستحيل: لا يمكن حذف زبون عليه دين (${formatDZD(client.credit_balance, false)})`
        : `Action impossible : un client avec une dette en cours (${formatDZD(client.credit_balance, false)})`);
      return;
    }
    if (!window.confirm(isAr ? `حذف الزبون ${client.name}؟` : `Supprimer ${client.name} ?`)) return;
    deleteClient(client.id);
    if (selectedClient?.id === client.id) setSelectedClient(clients.find(c => c.id !== client.id && c.id !== 1) ?? clients[0]);
    setCrudMsg('');
  };

  // Filter clients
  const filteredClients = clients.filter(c => {
    if (c.id === 1) return false; // Hide anonymous passager from debt carnet
    const q = searchQuery.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.phone.includes(q) || c.address.toLowerCase().includes(q);
  });

  // Client's unpaid/credit sales history
  // D3-fix: legally voided sales leave the carnet (status CANCELLED).
  const clientCreditSales = sales.filter(
    s => s.client_id === liveSelected?.id && s.payment_method === 'CREDIT' && s.status !== 'CANCELLED'
  );

  // Client's settlement history
  const clientSettlements = settlements.filter(s => s.client_id === liveSelected?.id);

  // Total outstanding debt in market
  const totalMarketDebt = clients.reduce((sum, c) => sum + (c.credit_balance || 0), 0);

  const handleOpenSettlement = (client: Client) => {
    setSelectedClient(client);
    setSettlementAmount(client.credit_balance);
    setSettleError('');
    setShowSettlementModal(true);
  };

  const handleExecuteSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || settlementAmount <= 0) return;
    setSettleError('');

    // D8-fix: settle the client the modal was opened for (no liveSelected detour).
    try {
      await settleClientDebt(
        selectedClient.id,
        settlementAmount,
        settlementMethod,
        settlementNote || (isAr ? 'تسديد دفعة على الحساب' : 'Versement acompte sur dette')
      );
    } catch (err) {
      setSettleError((err as Error).message);
      return;
    }

    // Gate-02 TASK 2+4: drawer kick on cash encaissement + acoustic seal.
    if (settlementMethod === 'ESPECES') kickDrawerViaLoopback();
    cashChime();
    setShowSettlementModal(false);
  };

  const handleCreateClient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName.trim()) return;
    setClientFormMsg('');

    let created;
    try {
      created = addClient({
        name: newClientName,
        phone: newClientPhone,
        address: newClientAddress,
        max_credit_limit: newClientLimit,
        nif: newClientNif,
      });
    } catch (err) {
      setClientFormMsg((err as Error).message);
      return;
    }

    setSelectedClient(created);
    setShowAddClientModal(false);
    setNewClientName('');
    setNewClientPhone('');
    setNewClientAddress('');
  };

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100dvh-80px)] bg-[#0b0f17] overflow-hidden">
      {/* LEFT COLUMN: Client List & Global Summary */}
      <div className="w-full lg:w-96 border-e border-[#1e293b] flex flex-col p-3 bg-[#0e141f]">
        {/* Header: Total Outstanding Market Credit */}
        <div className="bg-gradient-to-br from-rose-950/60 to-rose-900/30 border border-rose-800/40 rounded-xl p-3.5 mb-3 shadow-inner">
          <div className="flex items-center justify-between text-xs text-rose-300">
            <span className="flex items-center gap-1.5 font-semibold">
              <BookOpen className="w-4 h-4 text-rose-400" />
              <span>{isAr ? 'إجمالي ديون الزبائن:' : 'Total Crédit Clients (Carnet) :'}</span>
            </span>
          </div>
          <div className="text-2xl font-black font-mono text-rose-200 mt-1" dir="ltr">
            {formatDZD(totalMarketDebt, false)}
          </div>
          <div className="text-[11px] text-rose-300/80 mt-0.5">
            {filteredClients.length} {isAr ? 'زبائن مسجلين في الدفتر' : 'clients au carnet'}
            {' · '}
            <span className="text-rose-200 font-bold">{filteredClients.filter(c => (c.credit_balance || 0) > 0).length} {isAr ? 'مدين' : 'débiteurs'}</span>
            {' · '}
            <span className="text-emerald-300 font-bold">{filteredClients.filter(c => (c.credit_balance || 0) <= 0).length} {isAr ? 'مسدد' : 'soldés'}</span>
          </div>
        </div>

        {/* Search & Add Client Button */}
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute inset-y-0 start-3 my-auto text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={isAr ? 'بحث بالاسم أو الهاتف...' : 'Nom ou téléphone...'}
              className="w-full bg-[#111722] border border-[#233145] rounded-xl ps-9 pe-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-rose-500"
            />
          </div>

          <button
            onClick={() => setShowAddClientModal(true)}
            className="p-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl shadow cursor-pointer shrink-0"
            title={isAr ? 'إضافة زبون جديد في الدفتر' : 'Nouveau Client'}
            aria-label={isAr ? 'إضافة زبون جديد في الدفتر' : 'Nouveau Client'}
          >
            <UserPlus className="w-4 h-4" />
          </button>
        </div>

        {/* Client List */}
        {crudMsg && (
          <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 mb-2">
            {crudMsg}
          </div>
        )}
        <div className="flex-1 overflow-y-auto space-y-1.5 pe-1">
          {filteredClients.map(client => {
            const isSelected = liveSelected?.id === client.id;
            return (
              <div
                key={client.id}
                onClick={() => setSelectedClient(client)}
                className={`p-3 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-rose-950/40 border-rose-500 shadow-md'
                    : 'bg-[#111722] border-[#1e293b] hover:border-slate-600 text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white truncate">{client.name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); setEditingClient({ ...client }); setCrudMsg(''); }}
                      title={isAr ? 'تعديل' : 'Modifier'}
                      className="p-1 rounded text-slate-500 hover:text-sky-300 hover:bg-[#162030] cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); handleDeleteClient(client); }}
                      title={isAr ? 'حذف' : 'Supprimer'}
                      className="p-1 rounded text-slate-500 hover:text-rose-300 hover:bg-[#162030] cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <span
                      dir="ltr"
                      className={`text-xs font-bold font-mono px-2 py-0.5 rounded ${
                        client.credit_balance > 0
                          ? 'bg-rose-900/60 text-rose-300 border border-rose-700/50'
                          : 'bg-emerald-900/40 text-emerald-400'
                      }`}
                    >
                      {formatDZD(client.credit_balance, false)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3 text-slate-500" />
                    <span dir="ltr">{client.phone}</span>
                  </span>
                  <span>
                    {isAr ? 'السقف:' : 'Plafond:'} <span dir="ltr">{formatDZD(client.max_credit_limit, false)}</span>
                  </span>
                </div>
                {/* C3: ceiling consumption bar (hidden when unlimited). */}
                {(() => {
                  const bar = ceilingBar(Math.round(client.credit_balance * 100), Math.round(client.max_credit_limit * 100));
                  if (bar.pct === null) return null;
                  return (
                    <div className="mt-1.5 h-1.5 rounded-full bg-[#162030] overflow-hidden" title={isAr ? `استهلاك السقف ${bar.pct}%` : `${bar.pct}% du plafond`}>
                      <div className={`h-full rounded-full ${CEILING_TONE_CLASS[bar.tone as 'green' | 'amber' | 'red']}`} style={{ width: `${bar.pct}%` }} />
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT COLUMN: Client Ledger & Debt Settlement History */}
      <div className="flex-1 flex flex-col p-4 overflow-y-auto">
        {liveSelected ? (
          <div className="space-y-4">
            {/* Client Profile Card */}
            <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-black text-white">{liveSelected.name}</h2>
                  <span className="text-xs text-slate-400 font-mono">#{liveSelected.id}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-1">
                  <span className="flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-slate-500" />
                    <span dir="ltr">{liveSelected.phone || '-'}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-500" />
                    <span>{liveSelected.address || '-'}</span>
                  </span>
                  {liveSelected.nif && (
                    <span className="text-[11px] font-mono text-amber-400" dir="ltr">
                      NIF: {liveSelected.nif}
                    </span>
                  )}
                </div>
              </div>

              {/* Debt Action Button */}
              <div className="flex items-center gap-3">
                <div className="text-end">
                  <span className="text-[11px] text-slate-400 block">{isAr ? 'الدين المستحق الحالي:' : 'Reste Dû:'}</span>
                  <span className="text-2xl font-black font-mono text-rose-400" dir="ltr">
                    {formatDZD(liveSelected.credit_balance, false)}
                  </span>
                </div>

                <button
                  onClick={() => handleOpenSettlement(liveSelected)}
                  disabled={liveSelected.credit_balance <= 0}
                  className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-950/50 flex items-center gap-1.5 cursor-pointer"
                >
                  <DollarSign className="w-4 h-4" />
                  <span>{isAr ? 'تسجيل دفعة / تسديد' : 'Encaisser Versement'}</span>
                </button>
                <button
                  onClick={() => setShowStatement(true)}
                  className="px-4 py-2.5 bg-[#162030] hover:bg-[#233145] border border-[#2b3a4f] text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-amber-400" />
                  <span>{isAr ? 'كشف الحساب' : 'Relevé de Compte'}</span>
                </button>
              </div>
            </div>

            {/* Split Tables: Purchases on Credit vs Settlements Made */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Unpaid / Credit Invoices */}
              <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 shadow-lg flex flex-col">
                <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-amber-400" />
                  <span>{isAr ? 'فواتير ومشتريات بالدَّيْن' : 'Achats à Crédit'}</span>
                </h3>

                {clientCreditSales.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500">
                    {isAr ? 'لا توجد مشتريات بالكريدي مسجلة لهذا العميل' : 'Aucun achat à crédit enregistré'}
                  </div>
                ) : (
                  <div className="space-y-2 overflow-y-auto max-h-80 pe-1">
                    {clientCreditSales.map(sale => (
                      <div
                        key={sale.id}
                        className="bg-[#162030] border border-[#233145] rounded-xl p-2.5 flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-semibold text-slate-200">{sale.ticket_number}</div>
                          <div className="text-[10px] text-slate-400">
                            {new Date(sale.created_at).toLocaleString('fr-FR')} • {sale.items.length} {isAr ? 'منتج' : 'art.'}
                          </div>
                        </div>
                        <div className="text-end">
                          <span className="font-mono font-bold text-rose-400">
                            +{formatDZD(sale.total_ttc, false)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Settlement History (Versements) */}
              <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 shadow-lg flex flex-col">
                <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                  <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
                  <span>{isAr ? 'سجل دفعات التسديد (Versements)' : 'Historique des Versements'}</span>
                </h3>

                {clientSettlements.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500">
                    {isAr ? 'لم يتم تسجيل دفعات تسديد بعد' : 'Aucun versement enregistré'}
                  </div>
                ) : (
                  <div className="space-y-2 overflow-y-auto max-h-80 pe-1">
                    {clientSettlements.map(st => (
                      <div
                        key={st.id}
                        className="bg-[#162030] border border-emerald-900/40 rounded-xl p-2.5 flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-semibold text-emerald-300">
                            {isAr ? 'دفعة تسديد' : 'Versement sur Dette'} ({st.payment_method})
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {new Date(st.date).toLocaleString('fr-FR')} • {st.note || '-'}
                          </div>
                        </div>
                        <div className="text-end font-mono font-bold text-emerald-400">
                          -{formatDZD(st.amount, false)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-slate-500 text-sm">
            {isAr ? 'يرجى اختيار عميل من القائمة' : 'Sélectionnez un client'}
          </div>
        )}
      </div>

      {/* MODAL: Record Settlement Payment */}
      {showSettlementModal && liveSelected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#111722] border border-[#1e293b] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[#1e293b] flex justify-between items-center bg-[#0b0f17]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <span>{isAr ? 'تسجيل تسديد دين للعميل' : 'Règlement de Dette'}</span>
              </h3>
              <button
                onClick={() => setShowSettlementModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleExecuteSettlement} className="p-4 space-y-3">
              <div>
                <span className="text-xs text-slate-400">{isAr ? 'العميل:' : 'Client:'}</span>
                <div className="text-sm font-bold text-white mt-0.5">{liveSelected.name}</div>
                <div className="text-xs text-rose-400 mt-0.5">
                  {isAr ? 'الدين الإجمالي المطلوب:' : 'Solde restant:'}{' '}
                  <strong>{formatDZD(liveSelected.credit_balance, false)}</strong>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'مبلغ التسديد (دينار جزائري):' : 'Montant Versé (DZD):'}
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  max={liveSelected.credit_balance}
                  value={settlementAmount}
                  onChange={e => setSettlementAmount(parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2 text-white font-mono text-lg font-bold outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'طريقة الدفع:' : 'Mode:'}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSettlementMethod('ESPECES')}
                    className={`py-2 px-3 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 ${
                      settlementMethod === 'ESPECES'
                        ? 'bg-emerald-950/80 border-emerald-500 text-white'
                        : 'bg-[#162030] border-[#2b3a4f] text-slate-400'
                    }`}
                  >
                    <Banknote className="w-3.5 h-3.5" />
                    <span>{isAr ? 'نقداً (Espèces)' : 'Espèces'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettlementMethod('DAHABIYA')}
                    className={`py-2 px-3 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 ${
                      settlementMethod === 'DAHABIYA'
                        ? 'bg-emerald-950/80 border-emerald-500 text-white'
                        : 'bg-[#162030] border-[#2b3a4f] text-slate-400'
                    }`}
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>{isAr ? 'بطاقة ذهبية / CIB' : 'CIB/Dahabiya'}</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'ملاحظة (اختياري):' : 'Observation:'}
                </label>
                <input
                  type="text"
                  value={settlementNote}
                  onChange={e => setSettlementNote(e.target.value)}
                  placeholder={isAr ? 'مثال: تسديد شهر أكتوبر...' : 'Ex: Versement partiel...'}
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                {settleError && <span className="text-[11px] text-rose-300 self-center me-auto">{settleError}</span>}
                <button
                  type="button"
                  onClick={() => setShowSettlementModal(false)}
                  className="px-4 py-2 bg-[#162030] text-slate-300 rounded-lg text-xs"
                >
                  {isAr ? 'إلغاء' : 'Annuler'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold"
                >
                  {isAr ? 'تأكيد التسديد' : 'Confirmer le Règlement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* BRK-020 MODAL: Edit Client */}
      {editingClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#111722] border border-[#1e293b] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[#1e293b] flex justify-between items-center bg-[#0b0f17]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Pencil className="w-4 h-4 text-sky-400" />
                <span>{isAr ? 'تعديل الزبون' : 'Modifier Client'}</span>
              </h3>
              <button onClick={() => setEditingClient(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={e => {
                e.preventDefault();
                if (!editingClient.name.trim()) return;
                setClientFormMsg('');
                try {
                  updateClient(editingClient.id, {
                    name: editingClient.name,
                    phone: editingClient.phone,
                    address: editingClient.address,
                    max_credit_limit: editingClient.max_credit_limit,
                    nif: editingClient.nif,
                    notes: editingClient.notes,
                  });
                } catch (err) {
                  setClientFormMsg((err as Error).message);
                  return;
                }
                setSelectedClient({ ...editingClient });
                setEditingClient(null);
              }}
              className="p-4 space-y-3"
            >
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'اسم الزبون:' : 'Nom:'} *
                </label>
                <input
                  type="text" required
                  value={editingClient.name}
                  onChange={e => setEditingClient({ ...editingClient, name: e.target.value })}
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-rose-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">{isAr ? 'الهاتف:' : 'Téléphone:'}</label>
                  <input
                    type="tel"
                    value={editingClient.phone}
                    onChange={e => setEditingClient({ ...editingClient, phone: e.target.value })}
                    className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">{isAr ? 'سقف الدين (دج):' : 'Plafond (DZD):'}</label>
                  <input
                    type="number" min="0"
                    value={editingClient.max_credit_limit}
                    onChange={e => setEditingClient({ ...editingClient, max_credit_limit: Number(e.target.value) })}
                    className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">{isAr ? 'العنوان:' : 'Adresse:'}</label>
                <input
                  type="text"
                  value={editingClient.address}
                  onChange={e => setEditingClient({ ...editingClient, address: e.target.value })}
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">{isAr ? 'NIF (للشركات):' : 'NIF (Entreprises):'}</label>
                <input
                  type="text"
                  value={editingClient.nif ?? ''}
                  onChange={e => setEditingClient({ ...editingClient, nif: e.target.value })}
                  placeholder="15 chiffres"
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none font-mono"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                {clientFormMsg && <span className="text-[11px] text-rose-300 self-center me-auto">{clientFormMsg}</span>}
                <button type="button" onClick={() => setEditingClient(null)} className="px-4 py-2 bg-[#162030] text-slate-300 rounded-lg text-xs">
                  {isAr ? 'إلغاء' : 'Annuler'}
                </button>
                <button type="submit" className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold">
                  {isAr ? 'حفظ' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Add New Client */}
      {showAddClientModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#111722] border border-[#1e293b] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[#1e293b] flex justify-between items-center bg-[#0b0f17]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-rose-400" />
                <span>{isAr ? 'إضافة عميل جديد في دفتر الديون' : 'Nouveau Client au Carnet'}</span>
              </h3>
              <button
                onClick={() => setShowAddClientModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateClient} className="p-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'اسم العميل أو المؤسسة:' : 'Nom ou Raison Sociale:'} *
                </label>
                <input
                  type="text"
                  required
                  value={newClientName}
                  onChange={e => setNewClientName(e.target.value)}
                  placeholder="Ex: Mohamed Benali"
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'رقم الهاتف:' : 'Téléphone:'}
                </label>
                <input
                  type="tel"
                  value={newClientPhone}
                  onChange={e => setNewClientPhone(e.target.value)}
                  placeholder="0550 XX XX XX"
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'العنوان / الحي:' : 'Adresse:'}
                </label>
                <input
                  type="text"
                  value={newClientAddress}
                  onChange={e => setNewClientAddress(e.target.value)}
                  placeholder="Cité des Palmiers, Alger..."
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    {isAr ? 'سقف الدين (DZD):' : 'Plafond Crédit (DZD):'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={newClientLimit}
                    onChange={e => setNewClientLimit(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    {isAr ? 'NIF (للشركات):' : 'NIF (Entreprises):'}
                  </label>
                  <input
                    type="text"
                    value={newClientNif}
                    onChange={e => setNewClientNif(e.target.value)}
                    placeholder="15 chiffres"
                    className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none font-mono"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                {clientFormMsg && <span className="text-[11px] text-rose-300 self-center me-auto">{clientFormMsg}</span>}
                <button
                  type="button"
                  onClick={() => setShowAddClientModal(false)}
                  className="px-4 py-2 bg-[#162030] text-slate-300 rounded-lg text-xs"
                >
                  {isAr ? 'إلغاء' : 'Annuler'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold"
                >
                  {isAr ? 'حفظ الزبون' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Gate-03 TASK 2 — statement of account modal */}
      {showStatement && liveSelected && (
        <ClientAccountStatement
          client={liveSelected}
          creditSales={clientCreditSales}
          settlements={clientSettlements}
          onClose={() => setShowStatement(false)}
        />
      )}
    </div>
  );
};
