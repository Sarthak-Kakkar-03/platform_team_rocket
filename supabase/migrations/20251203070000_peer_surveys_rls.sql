-- RLS policies for peer_surveys table
-- Only teachers (instructors) and graders have access

-- Enable RLS on peer_surveys
ALTER TABLE peer_surveys ENABLE ROW LEVEL SECURITY;

-- Helper function to get class_id from survey_response_id without triggering RLS
CREATE OR REPLACE FUNCTION get_peer_survey_class_id(p_survey_response_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.class_id
  FROM public.survey_responses sr
  JOIN public.surveys s ON s.id = sr.survey_id
  WHERE sr.id = p_survey_response_id;
$$;

-- Drop existing policies if any
DROP POLICY IF EXISTS peer_surveys_all_staff ON peer_surveys;

-- Staff (instructors and graders) can do everything on peer_surveys
CREATE POLICY peer_surveys_all_staff ON peer_surveys
  FOR ALL
  USING (authorizeforclassgrader(get_peer_survey_class_id(peer_surveys.survey_response_id)))
  WITH CHECK (authorizeforclassgrader(get_peer_survey_class_id(peer_surveys.survey_response_id)));

