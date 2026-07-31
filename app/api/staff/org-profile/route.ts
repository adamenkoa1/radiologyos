import { requireOrgContext } from "../../../../lib/tenant";
import { dbBinding } from "../../../../lib/db";
import { audit } from "../../../../lib/audit";
import {
  FEATURE_FLAGS, FEATURE_LABELS, PROFILE_DESCRIPTIONS, PROFILE_LABELS, PROFILE_TYPES,
  getOrgProfile, isFeatureFlag, isProfileType, profilePresetFlags, resolveFlags,
  type FeatureFlag,
} from "../../../../lib/org-profile";


// Профіль організації та ефективні feature flags. organizationId — лише зі
// серверної сесії (requireOrgContext). Читання доступне всьому персоналу,
// зміна — лише адміністратору.
export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });

  const profile = await getOrgProfile(db, ctx);
  return Response.json({
    organization: { id: ctx.organizationId, name: ctx.organizationName, slug: ctx.slug },
    canManage: ctx.role === "admin",
    profileType: profile.profileType,
    profileLabel: profile.profileLabel,
    profileDescription: PROFILE_DESCRIPTIONS[profile.profileType],
    flags: profile.flags,
    overrides: profile.overrides,
    // Рекомендовані можливості пресета для поточного профілю.
    presetFlags: profilePresetFlags(profile.profileType),
    catalog: {
      profiles: PROFILE_TYPES.map((v) => ({ v, l: PROFILE_LABELS[v], d: PROFILE_DESCRIPTIONS[v] })),
      features: FEATURE_FLAGS.map((v) => ({ v, l: FEATURE_LABELS[v] })),
    },
  });
}

export async function PATCH(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (ctx.role !== "admin") {
    return Response.json({ error: "Профіль організації може змінювати лише адміністратор" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as {
    profileType?: string;
    flags?: Record<string, unknown>;
    applyPreset?: boolean;
  };

  const current = await getOrgProfile(db, ctx);
  const profileType = body.profileType && isProfileType(body.profileType) ? body.profileType : current.profileType;
  if (body.profileType && !isProfileType(body.profileType)) {
    return Response.json({ error: "Невідомий профіль організації" }, { status: 400 });
  }

  // Застосування пресета: рекомендовані можливості профілю стають явними
  // override-ами (усі решта наявних override-ів скидаються до пресета).
  // Інакше — точкове оновлення окремих прапорців.
  let overrides: Partial<Record<FeatureFlag, boolean>>;
  if (body.applyPreset) {
    overrides = { ...profilePresetFlags(profileType) };
  } else {
    overrides = { ...current.overrides };
    if (body.flags && typeof body.flags === "object") {
      for (const [key, value] of Object.entries(body.flags)) {
        if (isFeatureFlag(key)) overrides[key] = Boolean(value);
      }
    }
  }

  await db.prepare(
    `INSERT INTO organization_profiles (organization_id, profile_type, feature_flags_json, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(organization_id) DO UPDATE SET
       profile_type = excluded.profile_type,
       feature_flags_json = excluded.feature_flags_json,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(ctx.organizationId, profileType, JSON.stringify(overrides)).run();

  await audit(db, {
    organizationId: ctx.organizationId, actorEmail: ctx.member.email,
    action: "org_profile_update", resource: "settings", details: { profileType, applyPreset: !!body.applyPreset },
  });

  return Response.json({
    ok: true,
    profileType,
    profileLabel: PROFILE_LABELS[profileType],
    flags: resolveFlags(profileType, overrides),
    overrides,
  });
}
