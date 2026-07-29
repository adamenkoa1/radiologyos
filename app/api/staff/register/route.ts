export async function POST() {
  return Response.json(
    { error: "Самостійну реєстрацію вимкнено. Обліковий запис створює адміністратор." },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}
