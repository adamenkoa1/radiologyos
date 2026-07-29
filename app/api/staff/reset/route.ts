export async function POST() {
  return Response.json(
    { error: "Самостійне скидання пароля вимкнено. Зверніться до адміністратора." },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}
