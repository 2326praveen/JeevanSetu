-- =====================================================================
-- JeevanSetu AI: Phase 7 Dashboard Polish Migration
-- 1. Enable Realtime on public.facilities
-- 2. RPC toggle_rescue_team (Authority fleet control)
-- 3. RPC get_authority_dashboard_summary (Aggregated operational metrics)
-- =====================================================================

-- 1. ADD facilities TO REALTIME PUBLICATION
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'facilities'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.facilities;
    END IF;
END $$;

-- 2. TOGGLE RESCUE TEAM AVAILABILITY RPC
CREATE OR REPLACE FUNCTION public.toggle_rescue_team(
    target_team_id UUID,
    is_available BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    team RECORD;
BEGIN
    -- Verify authority or service role permission
    IF NOT (public.is_authority() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Access denied: only authorities can manage rescue teams';
    END IF;

    UPDATE public.rescue_teams
    SET available = is_available
    WHERE id = target_team_id
    RETURNING * INTO team;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Rescue team % not found', target_team_id;
    END IF;

    RETURN jsonb_build_object(
        'id', team.id,
        'name', team.name,
        'available', team.available,
        'type', team.type
    );
END;
$$;

-- 3. AGGREGATED OPERATIONAL METRICS RPC
CREATE OR REPLACE FUNCTION public.get_authority_dashboard_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    res JSONB;
BEGIN
    SELECT jsonb_build_object(
        'total_tickets', (SELECT COUNT(*) FROM public.tickets),
        'open_tickets', (SELECT COUNT(*) FROM public.tickets WHERE status = 'new'),
        'critical_tickets', (SELECT COUNT(*) FROM public.tickets WHERE urgency >= 4 AND status <> 'resolved'),
        'assigned_tickets', (SELECT COUNT(*) FROM public.tickets WHERE status = 'assigned'),
        'resolved_tickets', (SELECT COUNT(*) FROM public.tickets WHERE status = 'resolved'),
        'available_teams', (SELECT COUNT(*) FROM public.rescue_teams WHERE available = TRUE),
        'total_teams', (SELECT COUNT(*) FROM public.rescue_teams),
        'active_hazards', (SELECT COUNT(*) FROM public.hazard_reports WHERE is_active = TRUE),
        'total_shelter_capacity', COALESCE((SELECT SUM(capacity) FROM public.facilities WHERE kind = 'shelter'), 0),
        'total_shelter_occupancy', COALESCE((SELECT SUM(occupancy) FROM public.facilities WHERE kind = 'shelter'), 0)
    ) INTO res;

    RETURN res;
END;
$$;

