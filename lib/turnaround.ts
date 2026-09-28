// TAT (turnaround time) досліджень: час від виконання дослідження до готового,
// підписаного й виданого протоколу. Рахується з наявних дат bookings/protocols
// (performed_at → protocol_ready_at → signed_at → protocol_issued_at), а не з
// ручних агрегатів — за канонічним правилом business-core.

export type TatInput = {
  equipmentId: string;
  radiologistEmail: string;
  signedBy: string;
  performedAt: string;
  readyAt: string;
  signedAt: string;
  issuedAt: string;
};

// Години між двома мітками часу. Приймає і ISO з «T», і «YYYY-MM-DD HH:MM:SS».
// Некоректні або від'ємні різниці (зіпсовані дати) відкидаємо → null.
function hoursBetween(from: string, to: string): number | null {
  if (!from || !to) return null;
  const norm = (v: string) => (v.includes("T") || v.includes(" ") ? v : `${v}T00:00:00`);
  const a = Date.parse(norm(from));
  const b = Date.parse(norm(to));
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const h = (b - a) / 3600000;
  return h >= 0 ? h : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function avg(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export type TatStats = {
  performed: number;
  ready: number;
  signed: number;
  issued: number;
  signMedianH: number | null;
  signAvgH: number | null;
  issueMedianH: number | null;
  issueAvgH: number | null;
};

function statsFor(rows: TatInput[]): TatStats {
  const signH: number[] = [];
  const issueH: number[] = [];
  let ready = 0;
  let signed = 0;
  let issued = 0;
  for (const r of rows) {
    if (r.readyAt) ready += 1;
    if (r.signedAt) {
      signed += 1;
      const s = hoursBetween(r.performedAt, r.signedAt);
      if (s !== null) signH.push(s);
    }
    if (r.issuedAt) {
      issued += 1;
      const i = hoursBetween(r.performedAt, r.issuedAt);
      if (i !== null) issueH.push(i);
    }
  }
  return {
    performed: rows.length,
    ready,
    signed,
    issued,
    signMedianH: median(signH),
    signAvgH: avg(signH),
    issueMedianH: median(issueH),
    issueAvgH: avg(issueH),
  };
}

export type TatReport = {
  overall: TatStats;
  byModality: Array<{ equipmentId: string; stats: TatStats }>;
  byRadiologist: Array<{ email: string; signed: number; signMedianH: number | null }>;
};

export function computeTurnaround(rows: TatInput[]): TatReport {
  const modMap = new Map<string, TatInput[]>();
  for (const r of rows) {
    const key = r.equipmentId || "other";
    const arr = modMap.get(key) ?? [];
    arr.push(r);
    modMap.set(key, arr);
  }
  const byModality = [...modMap.entries()]
    .map(([equipmentId, rs]) => ({ equipmentId, stats: statsFor(rs) }))
    .sort((a, b) => b.stats.performed - a.stats.performed);

  const radMap = new Map<string, number[]>();
  for (const r of rows) {
    const who = r.signedBy || r.radiologistEmail;
    if (!who || !r.signedAt) continue;
    const h = hoursBetween(r.performedAt, r.signedAt);
    if (h === null) continue;
    const arr = radMap.get(who) ?? [];
    arr.push(h);
    radMap.set(who, arr);
  }
  const byRadiologist = [...radMap.entries()]
    .map(([email, hs]) => ({ email, signed: hs.length, signMedianH: median(hs) }))
    .sort((a, b) => b.signed - a.signed);

  return { overall: statsFor(rows), byModality, byRadiologist };
}
