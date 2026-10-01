import type { Client } from "pg";

/** Database-owner isolation for disposable integration fixtures only. */
export async function captureActivationFixture(admin: Client, restaurantId: string) {
  const { rows } = await admin.query<{ snapshot: unknown }>(
    `select jsonb_build_object(
      'restaurant',(select to_jsonb(a) from public.restaurant_activation_states a where restaurant_id=$1),
      'locations',(select jsonb_agg(to_jsonb(a)) from public.location_activation_states a where restaurant_id=$1),
      'checks',(select jsonb_agg(to_jsonb(c)) from public.onboarding_check_results c where restaurant_id=$1)
    ) snapshot`,
    [restaurantId],
  );
  return rows[0]!.snapshot;
}

export async function restoreActivationFixture(
  admin: Client,
  restaurantId: string,
  snapshot: unknown,
) {
  const parameters = [restaurantId, JSON.stringify(snapshot)];
  await admin.query("BEGIN");
  try {
    await admin.query(
      `update public.onboarding_check_results c set status=s.status,checked_by_user_id=s.checked_by_user_id,
      checked_at=s.checked_at,note=s.note,evidence_kind=s.evidence_kind,evidence_reference=s.evidence_reference
      from jsonb_populate_recordset(null::public.onboarding_check_results,$2::jsonb->'checks') s
      where c.restaurant_id=$1 and c.id=s.id`,
      parameters,
    );
    await admin.query(
      `update public.location_activation_states a set onboarding_status=s.onboarding_status,go_live_status=s.go_live_status,
      approved_by_user_id=s.approved_by_user_id,approved_at=s.approved_at,went_live_at=s.went_live_at,paused_at=s.paused_at
      from jsonb_populate_recordset(null::public.location_activation_states,$2::jsonb->'locations') s
      where a.restaurant_id=$1 and a.location_id=s.location_id`,
      parameters,
    );
    await admin.query(
      `update public.restaurant_activation_states a set onboarding_status=s.onboarding_status,go_live_status=s.go_live_status,
      approved_by_user_id=s.approved_by_user_id,approved_at=s.approved_at,went_live_at=s.went_live_at,paused_at=s.paused_at
      from jsonb_populate_record(null::public.restaurant_activation_states,$2::jsonb->'restaurant') s
      where a.restaurant_id=$1`,
      parameters,
    );
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}
