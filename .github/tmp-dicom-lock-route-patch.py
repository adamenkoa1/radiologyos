from pathlib import Path

path = Path("app/api/staff/imaging/route.ts")
text = path.read_text()

helper_anchor = "\nexport async function GET(request: Request) {"
helper = """
function isSignedImagingIdentityLock(error:unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /signed protocol imaging identity is immutable/i.test(message);
}
"""
if "function isSignedImagingIdentityLock" not in text:
    assert helper_anchor in text
    text = text.replace(helper_anchor, helper + helper_anchor, 1)

post_start = text.index("  await db.prepare(\n    `INSERT INTO imaging_studies\n      (organization_id, booking_id, accession_number, study_instance_uid, modality,")
post_end_marker = "    seriesCount, instancesCount, match.studyDatetime, member.email,\n  ).run();"
post_end = text.index(post_end_marker, post_start) + len(post_end_marker)
post_block = text[post_start:post_end]
wrapped_post = (
    "  try {\n"
    + post_block.replace("  await db.prepare(", "    await db.prepare(", 1).replace("\n  ).run();", "\n    ).run();", 1)
    + """
  } catch (error) {
    if (!isSignedImagingIdentityLock(error)) throw error;
    await recordRejected(db, ctx.organizationId, bookingId, "imaging_relink_rejected", "signed_protocol_identity_locked", member.email);
    return Response.json({
      ok:false,
      status:"locked",
      reason:"signed_protocol_identity_locked",
    }, { status:409 });
  }"""
)
text = text[:post_start] + wrapped_post + text[post_end:]

put_start = text.index("  await db.prepare(\n    `INSERT INTO imaging_studies\n       (organization_id, booking_id, accession_number, study_instance_uid, modality,")
put_end_marker = "    seriesCount, instancesCount, studyStatus, studyDatetime, source, member.email,\n  ).run();"
put_end = text.index(put_end_marker, put_start) + len(put_end_marker)
put_block = text[put_start:put_end]
wrapped_put = (
    "  try {\n"
    + put_block.replace("  await db.prepare(", "    await db.prepare(", 1).replace("\n  ).run();", "\n    ).run();", 1)
    + """
  } catch (error) {
    if (!isSignedImagingIdentityLock(error)) throw error;
    await recordRejected(db, ctx.organizationId, bookingId, "imaging_relink_rejected", "signed_protocol_identity_locked", member.email);
    return Response.json({
      ok:false,
      status:"locked",
      reason:"signed_protocol_identity_locked",
    }, { status:409 });
  }"""
)
text = text[:put_start] + wrapped_put + text[put_end:]

path.write_text(text)
