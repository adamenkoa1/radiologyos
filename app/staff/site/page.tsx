import { redirect } from "next/navigation";

// Стару адресу залишаємо як сумісне перенаправлення. Окремої «Вітрини»
// більше немає: увесь публічний контент редагується в структурі відділення.
export default function StaffSiteRedirect() {
  redirect("/staff/structure");
}
