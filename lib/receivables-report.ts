const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;

function validDate(value:string){
  if(!DATE_RE.test(value))return false;
  const date=new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}

export function normalizeReceivablesAsOf(value:unknown,fallback:string){
  const candidate=typeof value==="string"&&value.trim()?value.trim():fallback;
  if(!validDate(candidate))throw new Error("invalid_receivables_date");
  return candidate;
}

export type ReceivableBucket="0_30"|"31_60"|"61_90"|"90_plus";
export type ReceivableRow={
  bookingId:number;
  bookingCode:string;
  patientId:string;
  patientName:string;
  serviceTitle:string;
  currency:string;
  balance:number;
  outstandingSince:string;
  ageDays:number;
  bucket:ReceivableBucket;
};
export type PatientCreditRow=Omit<ReceivableRow,"outstandingSince"|"ageDays"|"bucket">;

function bucketFor(ageDays:number):ReceivableBucket{
  if(ageDays<=30)return "0_30";
  if(ageDays<=60)return "31_60";
  if(ageDays<=90)return "61_90";
  return "90_plus";
}

const BALANCE_CTE=`
  WITH scoped AS (
    SELECT
      m.id,m.booking_id,m.patient_id,m.currency,m.amount_delta,m.occurred_at,
      ROW_NUMBER() OVER (
        PARTITION BY m.booking_id,m.currency
        ORDER BY m.occurred_at,m.id
      ) AS seq,
      SUM(m.amount_delta) OVER (
        PARTITION BY m.booking_id,m.currency
        ORDER BY m.occurred_at,m.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS running_balance
    FROM patient_settlement_movements m
    WHERE m.organization_id=? AND substr(m.occurred_at,1,10)<=?
  ),
  closing AS (
    SELECT booking_id,currency,MAX(patient_id) AS patient_id,SUM(amount_delta) AS balance
    FROM scoped
    GROUP BY booking_id,currency
    HAVING SUM(amount_delta)<>0
  ),
  last_nonpositive AS (
    SELECT booking_id,currency,
      MAX(CASE WHEN running_balance<=0 THEN seq ELSE 0 END) AS last_nonpositive_seq
    FROM scoped
    GROUP BY booking_id,currency
  ),
  anchors AS (
    SELECT s.booking_id,s.currency,MIN(substr(s.occurred_at,1,10)) AS outstanding_since
    FROM scoped s
    JOIN last_nonpositive z ON z.booking_id=s.booking_id AND z.currency=s.currency
    WHERE s.seq>z.last_nonpositive_seq AND s.amount_delta>0
    GROUP BY s.booking_id,s.currency
  )`;

type RawBalanceRow={
  bookingId:number;bookingCode:string;patientId:string;patientName:string;serviceTitle:string;
  currency:string;balance:number;outstandingSince:string|null;ageDays:number|null;
};
type RawSummary={
  nonzeroCount:number;receivables:number;patientCredits:number;debtorBookings:number;creditBookings:number;
  bucket0to30:number;bucket31to60:number;bucket61to90:number;bucket90plus:number;
};

export async function buildReceivablesReport(db:D1Database,organizationId:number,asOf:string){
  const [detailResult,summaryRow]=await Promise.all([
    db.prepare(`${BALANCE_CTE}
      SELECT
        c.booking_id AS bookingId,
        b.code AS bookingCode,
        c.patient_id AS patientId,
        b.name AS patientName,
        b.service AS serviceTitle,
        c.currency,
        c.balance,
        CASE WHEN c.balance>0 THEN a.outstanding_since ELSE NULL END AS outstandingSince,
        CASE WHEN c.balance>0 AND a.outstanding_since IS NOT NULL
          THEN CAST(julianday(?) - julianday(a.outstanding_since) AS INTEGER)
          ELSE NULL END AS ageDays
      FROM closing c
      JOIN bookings b ON b.id=c.booking_id AND b.organization_id=?
      LEFT JOIN anchors a ON a.booking_id=c.booking_id AND a.currency=c.currency
      ORDER BY
        CASE WHEN c.balance>0 THEN 0 ELSE 1 END,
        CASE WHEN c.balance>0 THEN COALESCE(ageDays,0) ELSE 0 END DESC,
        ABS(c.balance) DESC,b.code,c.booking_id
      LIMIT 2001
    `).bind(organizationId,asOf,asOf,organizationId).all<RawBalanceRow>(),
    db.prepare(`${BALANCE_CTE},
      aged AS (
        SELECT c.balance,
          CASE WHEN c.balance>0 AND a.outstanding_since IS NOT NULL
            THEN MAX(0,CAST(julianday(?) - julianday(a.outstanding_since) AS INTEGER))
            ELSE NULL END AS age_days
        FROM closing c
        LEFT JOIN anchors a ON a.booking_id=c.booking_id AND a.currency=c.currency
      )
      SELECT
        COUNT(*) AS nonzeroCount,
        COALESCE(SUM(CASE WHEN balance>0 THEN balance ELSE 0 END),0) AS receivables,
        COALESCE(SUM(CASE WHEN balance<0 THEN -balance ELSE 0 END),0) AS patientCredits,
        COALESCE(SUM(CASE WHEN balance>0 THEN 1 ELSE 0 END),0) AS debtorBookings,
        COALESCE(SUM(CASE WHEN balance<0 THEN 1 ELSE 0 END),0) AS creditBookings,
        COALESCE(SUM(CASE WHEN balance>0 AND age_days BETWEEN 0 AND 30 THEN balance ELSE 0 END),0) AS bucket0to30,
        COALESCE(SUM(CASE WHEN balance>0 AND age_days BETWEEN 31 AND 60 THEN balance ELSE 0 END),0) AS bucket31to60,
        COALESCE(SUM(CASE WHEN balance>0 AND age_days BETWEEN 61 AND 90 THEN balance ELSE 0 END),0) AS bucket61to90,
        COALESCE(SUM(CASE WHEN balance>0 AND age_days>90 THEN balance ELSE 0 END),0) AS bucket90plus
      FROM aged
    `).bind(organizationId,asOf,asOf).first<RawSummary>(),
  ]);

  const rows=detailResult.results.slice(0,2000);
  const debtors:ReceivableRow[]=[];
  const credits:PatientCreditRow[]=[];
  for(const row of rows){
    const balance=Number(row.balance||0);
    if(balance>0){
      const ageDays=Math.max(0,Number(row.ageDays||0));
      debtors.push({
        bookingId:Number(row.bookingId),bookingCode:String(row.bookingCode||""),patientId:String(row.patientId||""),
        patientName:String(row.patientName||""),serviceTitle:String(row.serviceTitle||""),currency:String(row.currency||"UAH"),
        balance,outstandingSince:String(row.outstandingSince||asOf),ageDays,bucket:bucketFor(ageDays),
      });
    }else if(balance<0){
      credits.push({
        bookingId:Number(row.bookingId),bookingCode:String(row.bookingCode||""),patientId:String(row.patientId||""),
        patientName:String(row.patientName||""),serviceTitle:String(row.serviceTitle||""),currency:String(row.currency||"UAH"),
        balance,
      });
    }
  }

  const summary={
    receivables:Number(summaryRow?.receivables||0),
    patientCredits:Number(summaryRow?.patientCredits||0),
    debtorBookings:Number(summaryRow?.debtorBookings||0),
    creditBookings:Number(summaryRow?.creditBookings||0),
    buckets:{
      "0_30":Number(summaryRow?.bucket0to30||0),
      "31_60":Number(summaryRow?.bucket31to60||0),
      "61_90":Number(summaryRow?.bucket61to90||0),
      "90_plus":Number(summaryRow?.bucket90plus||0),
    },
  };
  const truncated=Number(summaryRow?.nonzeroCount||0)>2000;
  return {asOf,generatedAt:new Date().toISOString(),summary,debtors,credits,truncated};
}
