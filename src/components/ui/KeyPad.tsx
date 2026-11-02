import React from 'react';

/**
 * Unified touch-key cap — one language for the payment keypad and the
 * login PIN pad. Same cap (bg/border/press feedback); size is a two-step
 * scale: default = compact touch (~48px, POS cockpit + PIN), big = comfort
 * (~56px) for large-target moments. Role is expressed ONLY by text color.
 */
type KeyVariant = 'digit' | 'danger' | 'ok' | 'muted';

const TEXT: Record<KeyVariant, string> = {
  digit: 'text-white font-mono',
  danger: 'text-rose-300',
  ok: 'text-emerald-300',
  muted: 'text-slate-300',
};

export const Key: React.FC<{
  variant?: KeyVariant;
  big?: boolean;
  onPress: () => void;
  label: React.ReactNode;
  title?: string;
}> = ({ variant = 'digit', big = false, onPress, label, title }) => (
  <button
    type="button"
    onClick={onPress}
    title={title}
    className={`rounded-xl bg-[#162030] border border-[#2b3a4f] font-bold select-none cursor-pointer transition hover:bg-[#233145] active:scale-95 ${big ? 'py-3 text-xl' : 'py-2.5 text-lg'} ${TEXT[variant]}`}
  >
    {label}
  </button>
);

export const KeyPad: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid grid-cols-3 gap-1.5" dir="ltr">
    {children}
  </div>
);
