-- =====================================================================
-- JeevanSetu AI: Phase 5 Rescue Resource Optimizer Migration
-- 1. Add priority_score column to public.tickets
-- 2. compute_ticket_priorities RPC (urgency, vulnerability, waiting time, spatial cluster density)
-- 3. batch_assign_teams RPC (atomic one-click assignment)
-- 4. update_shelter_headcount RPC (real-time shelter occupancy tracking)
-- =====================================================================

-- 1. ADD priority_score TO TICKETS
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'tickets' 
          AND column_name = 'priority_score'
    ) THEN
        ALTER TABLE public.tickets 
        ADD COLUMN priority_score DOUBLE PRECISION DEFAULT 0;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tickets_priority_score ON public.tickets(priority_score DESC);

-- 2. COMPUTE TICKET PRIORITIES RPC
CREATE OR REPLACE FUNCTION public.compute_ticket_priorities()
RETURNS TABLE (
    ticket_id UUID,
    urgency INTEGER,
    priority_score DOUBLE PRECISION,
    cluster_size INTEGER,
    waiting_minutes INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Update priority_score for all non-resolved tickets using formula:
    -- Priority = (Urgency * 20) + (Vulnerabilities * 15) + (Waiting Mins * 1.5, max 60) + (Cluster Count * 10, max 40)
    RETURN QUERY
    WITH ticket_metrics AS (
        SELECT 
            t.id AS t_id,
            t.urgency AS t_urgency,
            GREATEST(0, EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 60)::INTEGER AS wait_mins,
            -- Vulnerability bonus: each flag adds 15 points; people_at_risk adds 5 points (capped at 25)
            (
                COALESCE(cardinality(t.vulnerable_flags), 0) * 15 +
                LEAST(25, COALESCE(t.people_at_risk, 1) * 5)
            ) AS vuln_points,
            -- Spatial cluster count: other open tickets within 1.5 km
            (
                SELECT COUNT(*)::INTEGER
                FROM public.tickets other
                WHERE other.id <> t.id
                  AND other.status IN ('new', 'assigned')
                  AND other.lat IS NOT NULL AND other.lng IS NOT NULL
                  AND t.lat IS NOT NULL AND t.lng IS NOT NULL
                  AND (6371.0 * acos(
                        LEAST(1.0, GREATEST(-1.0,
                            cos(radians(t.lat)) * cos(radians(other.lat)) *
                            cos(radians(other.lng) - radians(t.lng)) +
                            sin(radians(t.lat)) * sin(radians(other.lat))
                        ))
                      )) <= 1.5
            ) AS nearby_count
        FROM public.tickets t
        WHERE t.status IN ('new', 'assigned')
    ),
    calculated AS (
        SELECT 
            tm.t_id,
            tm.t_urgency,
            tm.wait_mins,
            tm.nearby_count,
            ROUND(
                (
                    (tm.t_urgency * 20.0) +
                    tm.vuln_points +
                    LEAST(60.0, tm.wait_mins * 1.5) +
                    LEAST(40.0, tm.nearby_count * 10.0)
                )::numeric, 1
            )::DOUBLE PRECISION AS computed_score
        FROM ticket_metrics tm
    )
    UPDATE public.tickets t
    SET priority_score = c.computed_score
    FROM calculated c
    WHERE t.id = c.t_id
    RETURNING 
        t.id AS ticket_id,
        t.urgency,
        t.priority_score,
        c.nearby_count AS cluster_size,
        c.wait_mins AS waiting_minutes;
END;
$$;

-- 3. BATCH ASSIGN TEAMS RPC (One-Click Accept)
CREATE OR REPLACE FUNCTION public.batch_assign_teams(assignments JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    item JSONB;
    t_id UUID;
    u_id UUID;
    t_name TEXT;
    assigned_count INTEGER := 0;
BEGIN
    -- Verify authority or service role permission
    IF NOT (public.is_authority() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Access denied: only authorities can batch assign rescue teams';
    END IF;

    FOR item IN SELECT * FROM jsonb_array_elements(assignments)
    LOOP
        t_id := (item->>'ticket_id')::UUID;
        u_id := (item->>'team_id')::UUID;

        -- Check if team is available
        SELECT name INTO t_name FROM public.rescue_teams WHERE id = u_id AND available = TRUE;

        IF t_name IS NOT NULL THEN
            -- Update ticket
            UPDATE public.tickets
            SET assigned_team_id = u_id,
                status = 'assigned',
                updated_at = NOW()
            WHERE id = t_id;

            -- Mark team unavailable
            UPDATE public.rescue_teams
            SET available = FALSE
            WHERE id = u_id;

            -- Audit log
            INSERT INTO public.ticket_events (ticket_id, actor, event, metadata)
            VALUES (
                t_id,
                COALESCE(auth.jwt() ->> 'email', 'authority_system'),
                'batch_assigned',
                jsonb_build_object('team_id', u_id, 'team_name', t_name)
            );

            assigned_count := assigned_count + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', TRUE,
        'assigned_count', assigned_count
    );
END;
$$;

-- 4. UPDATE SHELTER HEADCOUNT RPC
CREATE OR REPLACE FUNCTION public.update_shelter_headcount(
    target_facility_id UUID,
    delta_headcount INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    fac RECORD;
    new_occ INTEGER;
BEGIN
    SELECT * INTO fac FROM public.facilities WHERE id = target_facility_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Facility % not found', target_facility_id;
    END IF;

    new_occ := GREATEST(0, fac.occupancy + delta_headcount);

    UPDATE public.facilities
    SET occupancy = new_occ
    WHERE id = target_facility_id;

    RETURN jsonb_build_object(
        'id', fac.id,
        'name', fac.name,
        'capacity', fac.capacity,
        'occupancy', new_occ,
        'utilization_pct', ROUND((new_occ::NUMERIC / GREATEST(1, fac.capacity) * 100)::numeric, 1)
    );
END;
$$;

