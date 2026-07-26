import { isBookableDate, TIMES } from "../../../lib/booking-rules";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") || "";
  if (!isBookableDate(date)) return Response.json({ times:[] });
  const db = dbBinding();
  if (!db) return Response.json({ error:"Сервіс тимчасово недоступний" }, { status:503 });
  const result = await db.prepare(
    `SELECT desired_time AS time FROM bookings
     WHERE desired_date = ? AND status NOT IN ('cancelled','completed')`
  ).bind(date).all();
  const busy = new Set((result.results as {time:string}[]).map(row => row.time));
  return Response.json({ times:TIMES.filter(time => !busy.has(time)) });
}
