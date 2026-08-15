import type { ReactNode } from "react";
import ProtocolWorkspaceSubnav from "./protocol-workspace-subnav";

export default function ProtocolsLayout({ children }:{ children:ReactNode }) {
  return <>
    {children}
    <ProtocolWorkspaceSubnav />
  </>;
}
