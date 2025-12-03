-- Simple RLS policies for survey tables
-- Replaces complex policies that caused infinite recursion

-- Helper function to get class_id from survey without triggering RLS
-- Uses existing authorization functions from the codebase where possible
CREATE OR REPLACE FUNCTION get_survey_class_id(p_survey_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT class_id FROM public.surveys WHERE id = p_survey_id;
$$;

-- ============================================
-- SURVEYS TABLE
-- ============================================
ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS surveys_select_staff ON surveys;
DROP POLICY IF EXISTS surveys_select_students ON surveys;
DROP POLICY IF EXISTS surveys_all_staff ON surveys;

-- Staff (instructors and graders) can do everything on surveys
-- Uses existing authorizeforclassgrader function from the codebase
CREATE POLICY surveys_all_staff ON surveys
  FOR ALL
  USING (authorizeforclassgrader(surveys.class_id))
  WITH CHECK (authorizeforclassgrader(surveys.class_id));

-- Students can only select surveys if they have a corresponding survey_response
CREATE POLICY surveys_select_students ON surveys
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.survey_responses sr
      JOIN public.user_roles ur ON ur.private_profile_id = sr.profile_id
      WHERE sr.survey_id = surveys.id
        AND ur.user_id = auth.uid()
        AND ur.class_id = surveys.class_id
        AND ur.disabled = false
    )
  );

-- ============================================
-- SURVEY_TEMPLATES TABLE
-- ============================================
ALTER TABLE survey_templates ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS survey_templates_select ON survey_templates;
DROP POLICY IF EXISTS survey_templates_insert ON survey_templates;
DROP POLICY IF EXISTS survey_templates_update ON survey_templates;
DROP POLICY IF EXISTS survey_templates_select_staff ON survey_templates;
DROP POLICY IF EXISTS survey_templates_insert_instructors ON survey_templates;
DROP POLICY IF EXISTS survey_templates_update_instructors ON survey_templates;
DROP POLICY IF EXISTS survey_templates_all_staff ON survey_templates;

-- Staff (instructors and graders) can do everything on survey templates
-- Uses existing authorizeforclassgrader function from the codebase
CREATE POLICY survey_templates_all_staff ON survey_templates
  FOR ALL
  USING (authorizeforclassgrader(survey_templates.class_id))
  WITH CHECK (authorizeforclassgrader(survey_templates.class_id));

-- ============================================
-- SURVEY_RESPONSES TABLE
-- ============================================
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS survey_responses_select_owner ON survey_responses;
DROP POLICY IF EXISTS survey_responses_select_staff ON survey_responses;
DROP POLICY IF EXISTS survey_responses_insert_owner ON survey_responses;
DROP POLICY IF EXISTS survey_responses_update_owner ON survey_responses;
DROP POLICY IF EXISTS survey_responses_all_owner ON survey_responses;
DROP POLICY IF EXISTS survey_responses_insert_staff ON survey_responses;
DROP POLICY IF EXISTS survey_responses_update_staff ON survey_responses;
DROP POLICY IF EXISTS survey_responses_all_staff ON survey_responses;

-- Staff (instructors and graders) can do everything on survey responses
-- Uses existing authorizeforclassgrader function from the codebase
CREATE POLICY survey_responses_all_staff ON survey_responses
  FOR ALL
  USING (authorizeforclassgrader(get_survey_class_id(survey_responses.survey_id)))
  WITH CHECK (authorizeforclassgrader(get_survey_class_id(survey_responses.survey_id)));

-- Students can only select and update their own responses
-- Uses existing authorizeforprofile function which checks if user owns the profile
CREATE POLICY survey_responses_select_owner ON survey_responses
  FOR SELECT
  USING (authorizeforprofile(survey_responses.profile_id));

CREATE POLICY survey_responses_update_owner ON survey_responses
  FOR UPDATE
  USING (authorizeforprofile(survey_responses.profile_id))
  WITH CHECK (authorizeforprofile(survey_responses.profile_id));

