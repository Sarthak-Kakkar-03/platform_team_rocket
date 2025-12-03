-- Enable RLS on live_polls and live_poll_responses
ALTER TABLE live_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_poll_responses ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS live_polls_all_staff ON live_polls;
DROP POLICY IF EXISTS live_polls_select ON live_polls;
DROP POLICY IF EXISTS live_polls_responses_all_staff ON live_poll_responses;
DROP POLICY IF EXISTS live_polls_responses_insert ON live_poll_responses;
DROP POLICY IF EXISTS live_polls_responses_select ON live_poll_responses;

-- Staff (instructors and graders) can do everything on live polls
CREATE POLICY live_polls_all_staff ON live_polls
  FOR ALL
  USING (authorizeforclassgrader(live_polls.class_id))
  WITH CHECK (authorizeforclassgrader(live_polls.class_id));

-- Students and anyone can select live polls if:
-- 1. require_login is false (anyone can see), OR
-- 2. require_login is true AND user is in the class
CREATE POLICY live_polls_select ON live_polls
  FOR SELECT
  USING (
    NOT live_polls.require_login
    OR (
      live_polls.require_login
      AND EXISTS (
        SELECT 1
        FROM public.user_roles ur
        WHERE ur.class_id = live_polls.class_id
          AND ur.user_id = auth.uid()
          AND ur.disabled = false
      )
    )
  );

-- Staff (instructors and graders) can do everything on live poll responses
CREATE POLICY live_polls_responses_all_staff ON live_poll_responses
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.live_polls lp
      WHERE lp.id = live_poll_responses.live_poll_id
        AND authorizeforclassgrader(lp.class_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.live_polls lp
      WHERE lp.id = live_poll_responses.live_poll_id
        AND authorizeforclassgrader(lp.class_id)
    )
  );

-- Students can select their own responses or responses for polls they can see
CREATE POLICY live_polls_responses_select ON live_poll_responses
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.live_polls lp
      WHERE lp.id = live_poll_responses.live_poll_id
        AND (
          NOT lp.require_login
          OR (
            lp.require_login
            AND (
              live_poll_responses.public_profile_id IS NULL
              OR EXISTS (
                SELECT 1
                FROM public.user_roles ur
                WHERE ur.public_profile_id = live_poll_responses.public_profile_id
                  AND ur.user_id = auth.uid()
                  AND ur.class_id = lp.class_id
                  AND ur.disabled = false
              )
            )
          )
        )
    )
  );

-- Students can insert responses if:
-- 1. require_login is false (anyone can respond), OR
-- 2. require_login is true AND user is in the class (public_profile_id can be null for anonymous)
CREATE POLICY live_polls_responses_insert ON live_poll_responses
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.live_polls lp
      WHERE lp.id = live_poll_responses.live_poll_id
        AND (
          NOT lp.require_login
          OR (
            lp.require_login
            AND (
              live_poll_responses.public_profile_id IS NULL
              OR EXISTS (
                SELECT 1
                FROM public.user_roles ur
                WHERE ur.public_profile_id = live_poll_responses.public_profile_id
                  AND ur.user_id = auth.uid()
                  AND ur.class_id = lp.class_id
                  AND ur.disabled = false
              )
            )
          )
        )
    )
  );