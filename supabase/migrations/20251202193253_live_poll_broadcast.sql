-- Migration: Add broadcast triggers for live polls
-- This follows the same pattern as other course-scoped tables

CREATE OR REPLACE FUNCTION public.broadcast_live_poll_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    target_class_id bigint;
    staff_payload jsonb;
    affected_profile_ids uuid[];
    profile_id uuid;
BEGIN
    -- Get the class_id from the record
    IF TG_OP = 'INSERT' THEN
        target_class_id := NEW.class_id;
    ELSIF TG_OP = 'UPDATE' THEN
        target_class_id := COALESCE(NEW.class_id, OLD.class_id);
    ELSIF TG_OP = 'DELETE' THEN
        target_class_id := OLD.class_id;
    END IF;

    IF target_class_id IS NOT NULL THEN
        -- Create payload
        staff_payload := jsonb_build_object(
            'type', 'table_change',
            'operation', TG_OP,
            'table', TG_TABLE_NAME,
            'row_id', CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
            'data', CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END,
            'class_id', target_class_id,
            'timestamp', NOW()
        );

        -- Broadcast to staff channel
        PERFORM realtime.send(
            staff_payload,
            'broadcast',
            'class:' || target_class_id || ':staff',
            true
        );

        -- Broadcast to all students in the class (for live poll visibility)
        SELECT ARRAY(
            SELECT ur.private_profile_id
            FROM user_roles ur
            WHERE ur.class_id = target_class_id AND ur.role = 'student'
        ) INTO affected_profile_ids;

        FOREACH profile_id IN ARRAY affected_profile_ids LOOP
            PERFORM realtime.send(
                staff_payload,
                'broadcast',
                'class:' || target_class_id || ':user:' || profile_id,
                true
            );
        END LOOP;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

-- Create trigger for live_polls
DROP TRIGGER IF EXISTS broadcast_live_polls_realtime ON live_polls;
CREATE TRIGGER broadcast_live_polls_realtime
    AFTER INSERT OR UPDATE OR DELETE ON live_polls
    FOR EACH ROW
    EXECUTE FUNCTION broadcast_live_poll_change();


-- Function for live_poll_responses (needs to get class_id from parent poll)
-- Only broadcasts to staff channel since students don't see response counts
CREATE OR REPLACE FUNCTION public.broadcast_live_poll_response_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    target_class_id bigint;
    target_poll_id uuid;
    staff_payload jsonb;
BEGIN
    -- Get the poll_id and class_id
    IF TG_OP = 'INSERT' THEN
        target_poll_id := NEW.live_poll_id;
    ELSIF TG_OP = 'UPDATE' THEN
        target_poll_id := COALESCE(NEW.live_poll_id, OLD.live_poll_id);
    ELSIF TG_OP = 'DELETE' THEN
        target_poll_id := OLD.live_poll_id;
    END IF;

    -- Get class_id from the parent poll
    SELECT class_id INTO target_class_id
    FROM live_polls
    WHERE id = target_poll_id;

    IF target_class_id IS NOT NULL THEN
        -- Create payload
        staff_payload := jsonb_build_object(
            'type', 'table_change',
            'operation', TG_OP,
            'table', TG_TABLE_NAME,
            'row_id', CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
            'data', CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END,
            'class_id', target_class_id,
            'live_poll_id', target_poll_id,
            'timestamp', NOW()
        );

        -- Only broadcast to staff channel (students don't need response updates)
        PERFORM realtime.send(
            staff_payload,
            'broadcast',
            'class:' || target_class_id || ':staff',
            true
        );
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

-- Create trigger for live_poll_responses
DROP TRIGGER IF EXISTS broadcast_live_poll_responses_realtime ON live_poll_responses;
CREATE TRIGGER broadcast_live_poll_responses_realtime
    AFTER INSERT OR UPDATE OR DELETE ON live_poll_responses
    FOR EACH ROW
    EXECUTE FUNCTION broadcast_live_poll_response_change();