from pathlib import Path

path = Path("app/api/staff/imaging/route.ts")
text = path.read_text()
old = '''function publicSettings(pacs:PacsRow) {
  return {
    enabled:!!pacs.enabled,
    viewerBaseUrl:pacs.viewerBaseUrl,
    aeTitle:pacs.aeTitle,
    dicomwebConfigured:!!pacs.dicomwebBaseUrl,
  };
}'''
new = '''function trustedViewerBaseUrl(pacs:PacsRow):string {
  const base = String(pacs.viewerBaseUrl || "").trim();
  if (!base) return "";
  const policyUrl = base.replace(/\\{study\\}/g, "0");
  return safeOutboundUrl(policyUrl) ? base : "";
}

function publicSettings(pacs:PacsRow) {
  return {
    enabled:!!pacs.enabled,
    viewerBaseUrl:trustedViewerBaseUrl(pacs),
    aeTitle:pacs.aeTitle,
    dicomwebConfigured:!!pacs.dicomwebBaseUrl,
  };
}'''
if old not in text:
    raise SystemExit("publicSettings block not found")
text = text.replace(old, new)
text = text.replace("viewerUrl(pacs.viewerBaseUrl,", "viewerUrl(trustedViewerBaseUrl(pacs),")
path.write_text(text)
