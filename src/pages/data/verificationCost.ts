// AeroAPI's per-row cost is fractions of a cent (e.g. $0.015), too small to show at the dashboard's
// 2-decimal currency format without rounding to zero, so this allows up to 4.
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })

/** en-US USD with 2 to 4 decimals: 0 → "$0.00", 0.015 → "$0.015", 5 → "$5.00". */
export function formatUsd(amount: number): string {
  return usd.format(amount)
}

/**
 * "12 × $0.015 = $0.18", and with a month, "12 × $0.015 = $0.18 · this month $2.10 of $5.00".
 * `perRowUsd` is already the sum of the checked sources' costs.
 */
export function costLine(rowCount: number, perRowUsd: number, month?: { spentUsd: number; budgetUsd: number }): string {
  const line = `${rowCount} × ${formatUsd(perRowUsd)} = ${formatUsd(rowCount * perRowUsd)}`
  return month ? `${line} · this month ${formatUsd(month.spentUsd)} of ${formatUsd(month.budgetUsd)}` : line
}
