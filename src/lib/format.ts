// Small formatting helpers shared by the UI.

export function formatCurrency(amount: number): string {
  const value = Math.round(amount * 100) / 100;
  const hasDecimals = value % 1 !== 0;
  return `₹${value.toLocaleString('en-IN', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${formatDate(iso)} · ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
}

export function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

// "2026-10" key for grouping by month, in the DEVICE's local timezone.
//
// Deliberately not `iso.slice(0, 7)`: the stored value is a UTC ISO string, so
// slicing it reads the UTC month. A payment at 00:30 IST on 1 Oct is
// "2026-09-30T19:00:00.000Z" and would be filed under September. Reading the
// local calendar fields off the parsed Date is what matches what the user sees
// on their own clock.
//
// Comparing against monthKey(new Date().toISOString()) is consistent with this:
// `new Date()` parses back to the same instant, so both sides resolve to the
// same local month.
export function monthKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 7);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${month}`;
}

export function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, 1).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
}
