"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./protocol-workspace-subnav.module.css";

export default function ProtocolWorkspaceSubnav() {
  const pathname = usePathname();
  const corrections = pathname.startsWith("/staff/protocols/corrections");
  return <nav className={styles.nav} aria-label="Розділи протоколів">
    <Link className={!corrections ? styles.active : ""} href="/staff/protocols">Протоколи</Link>
    <Link className={corrections ? styles.active : ""} href="/staff/protocols/corrections">Виправлення</Link>
  </nav>;
}
