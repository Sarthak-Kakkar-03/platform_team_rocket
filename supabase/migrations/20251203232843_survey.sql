-- Drop existing objects
DROP TABLE IF EXISTS peer_surveys CASCADE;
DROP TABLE IF EXISTS survey_assignees CASCADE;
DROP TABLE IF EXISTS survey_assignments CASCADE;
DROP TABLE IF EXISTS survey_responses CASCADE;
DROP TABLE IF EXISTS survey_templates CASCADE;
DROP TABLE IF EXISTS surveys CASCADE;

-- Drop functions and types
DROP FUNCTION IF EXISTS create_survey_assignments(UUID, UUID[]) CASCADE;
DROP FUNCTION IF EXISTS create_survey_response_assignments(UUID, UUID[]) CASCADE;
DROP FUNCTION IF EXISTS create_survey_responses_for_all_students(UUID) CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_survey_column() CASCADE;
DROP FUNCTION IF EXISTS set_survey_submitted_at() CASCADE;
DROP FUNCTION IF EXISTS get_survey_class_id(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_peer_survey_class_id(UUID) CASCADE;
DROP FUNCTION IF EXISTS authorizeforanyclassstaff() CASCADE;
DROP TYPE IF EXISTS survey_status CASCADE;
DROP TYPE IF EXISTS survey_type CASCADE;
DROP TYPE IF EXISTS template_scope CASCADE;

-- Create ENUM types
CREATE TYPE survey_status AS ENUM ('draft', 'published', 'closed');
CREATE TYPE survey_type AS ENUM ('assign_all', 'specific_students', 'peer_review');
CREATE TYPE template_scope AS ENUM ('global', 'course');

-- Create surveys table
CREATE TABLE surveys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id UUID NOT NULL DEFAULT gen_random_uuid(),
    class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    json JSONB NOT NULL DEFAULT '[]'::jsonb,
    status survey_status NOT NULL DEFAULT 'draft',
    survey_type survey_type NOT NULL DEFAULT 'assign_all',
    allow_response_editing BOOLEAN NOT NULL DEFAULT FALSE,
    due_date TIMESTAMPTZ DEFAULT NULL,
    validation_errors TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ DEFAULT NULL,
    version INTEGER NOT NULL DEFAULT 1
);

-- Create survey_templates table
CREATE TABLE survey_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    template JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    scope template_scope NOT NULL DEFAULT 'course',
    class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE
);

-- Create survey_responses table
CREATE TABLE survey_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  response JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at TIMESTAMPTZ DEFAULT NULL,
  is_submitted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ DEFAULT NULL,
  CONSTRAINT survey_responses_unique_per_profile UNIQUE (survey_id, profile_id)
);

-- Create peer_surveys table
CREATE TABLE peer_surveys (
    target_private_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    survey_response_id UUID NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE
);

-- Create indexes
CREATE INDEX idx_surveys_class_active
  ON surveys (class_id, deleted_at)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_surveys_survey_id_version
  ON surveys (survey_id, version DESC);

CREATE INDEX idx_surveys_created_by
  ON surveys (created_by);

CREATE INDEX idx_survey_responses_survey_id_active
  ON survey_responses (survey_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_responses_survey_user
  ON survey_responses(survey_id, profile_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_survey_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers to automatically update updated_at
CREATE TRIGGER update_surveys_updated_at
  BEFORE UPDATE ON surveys
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_survey_column();

CREATE TRIGGER update_survey_responses_updated_at
  BEFORE UPDATE ON survey_responses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_survey_column();

CREATE TRIGGER update_survey_templates_updated_at
  BEFORE UPDATE ON survey_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_survey_column();

-- Automatically set submitted_at when survey is submitted
CREATE OR REPLACE FUNCTION set_survey_submitted_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_submitted = TRUE
     AND (OLD.is_submitted = FALSE OR OLD.is_submitted IS NULL) THEN
    NEW.submitted_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_survey_submitted_at_trigger
  BEFORE INSERT OR UPDATE ON survey_responses
  FOR EACH ROW
  EXECUTE FUNCTION set_survey_submitted_at();

-- Helper function to get class_id from survey without triggering RLS
CREATE OR REPLACE FUNCTION get_survey_class_id(p_survey_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT class_id FROM public.surveys WHERE id = p_survey_id;
$$;

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

-- Helper function to check if user has a survey_response for a survey (bypasses RLS to avoid recursion)
CREATE OR REPLACE FUNCTION user_has_survey_response(p_survey_id UUID, p_user_id UUID, p_class_id BIGINT)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.survey_responses sr
    JOIN public.user_roles ur ON ur.private_profile_id = sr.profile_id
    WHERE sr.survey_id = p_survey_id
      AND ur.user_id = p_user_id
      AND ur.class_id = p_class_id
      AND ur.disabled = false
  );
$$;

-- Function to check if user is staff (instructor/grader) in ANY class
CREATE OR REPLACE FUNCTION public.authorizeforanyclassstaff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_privileges up
    WHERE up.user_id = auth.uid()
    AND up.role IN ('instructor', 'grader')
  );
$$;

-- Create a function to pre-create survey_responses for specific students
CREATE OR REPLACE FUNCTION create_survey_response_assignments(
  p_survey_id UUID,
  p_profile_ids UUID[]
)
RETURNS void AS $$
DECLARE
  v_class_id BIGINT;
BEGIN
  SELECT class_id INTO v_class_id
  FROM public.surveys
  WHERE id = p_survey_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Survey not found';
  END IF;
  
  IF NOT authorizeforclassinstructor(v_class_id) THEN
    RAISE EXCEPTION 'Permission denied: only instructors can manage survey assignments';
  END IF;
  
  DELETE FROM survey_responses 
  WHERE survey_id = p_survey_id 
    AND is_submitted = FALSE;
  
  INSERT INTO survey_responses (survey_id, profile_id, response, is_submitted)
  SELECT p_survey_id, unnest(p_profile_ids), '{}'::jsonb, FALSE
  ON CONFLICT (survey_id, profile_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_survey_response_assignments(UUID, UUID[]) TO authenticated;

COMMENT ON FUNCTION create_survey_response_assignments IS 'Pre-create empty survey_responses for specific students. Only callable by instructors.';

-- Create a function to pre-create survey_responses for ALL students in a class
CREATE OR REPLACE FUNCTION create_survey_responses_for_all_students(
  p_survey_id UUID
)
RETURNS void AS $$
DECLARE
  v_class_id BIGINT;
BEGIN
  SELECT class_id INTO v_class_id
  FROM public.surveys
  WHERE id = p_survey_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Survey not found';
  END IF;
  
  IF NOT authorizeforclassinstructor(v_class_id) THEN
    RAISE EXCEPTION 'Permission denied: only instructors can manage survey assignments';
  END IF;
  
  DELETE FROM survey_responses 
  WHERE survey_id = p_survey_id 
    AND is_submitted = FALSE;
  
  INSERT INTO survey_responses (survey_id, profile_id, response, is_submitted)
  SELECT p_survey_id, ur.private_profile_id, '{}'::jsonb, FALSE
  FROM public.user_roles ur
  WHERE ur.class_id = v_class_id
    AND ur.role = 'student'
    AND ur.private_profile_id IS NOT NULL
  ON CONFLICT (survey_id, profile_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_survey_responses_for_all_students(UUID) TO authenticated;

COMMENT ON FUNCTION create_survey_responses_for_all_students IS 'Pre-create empty survey_responses for all students in the class. Only callable by instructors.';

-- Enable RLS on all survey tables
ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE peer_surveys ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS surveys_select_staff ON surveys;
DROP POLICY IF EXISTS surveys_select_students ON surveys;
DROP POLICY IF EXISTS surveys_all_staff ON surveys;
DROP POLICY IF EXISTS surveys_insert_instructors ON surveys;
DROP POLICY IF EXISTS surveys_update_instructors ON surveys;
DROP POLICY IF EXISTS survey_templates_select ON survey_templates;
DROP POLICY IF EXISTS survey_templates_insert ON survey_templates;
DROP POLICY IF EXISTS survey_templates_update ON survey_templates;
DROP POLICY IF EXISTS survey_templates_delete ON survey_templates;
DROP POLICY IF EXISTS survey_templates_all_staff ON survey_templates;
DROP POLICY IF EXISTS survey_responses_select_owner ON survey_responses;
DROP POLICY IF EXISTS survey_responses_select_staff ON survey_responses;
DROP POLICY IF EXISTS survey_responses_insert_owner ON survey_responses;
DROP POLICY IF EXISTS survey_responses_update_owner ON survey_responses;
DROP POLICY IF EXISTS survey_responses_all_owner ON survey_responses;
DROP POLICY IF EXISTS survey_responses_insert_staff ON survey_responses;
DROP POLICY IF EXISTS survey_responses_update_staff ON survey_responses;
DROP POLICY IF EXISTS survey_responses_all_staff ON survey_responses;
DROP POLICY IF EXISTS peer_surveys_all_staff ON peer_surveys;
DROP POLICY IF EXISTS peer_surveys_select_students ON peer_surveys;

-- SURVEYS TABLE POLICIES
-- Staff (instructors and graders) can do everything on surveys
CREATE POLICY surveys_all_staff ON surveys
  FOR ALL
  USING (authorizeforclassgrader(surveys.class_id))
  WITH CHECK (authorizeforclassgrader(surveys.class_id));

-- Students can only select surveys if they have a corresponding survey_response
-- Uses SECURITY DEFINER function to avoid infinite recursion with survey_responses RLS
CREATE POLICY surveys_select_students ON surveys
  FOR SELECT
  USING (
    public.user_has_survey_response(surveys.id, auth.uid(), surveys.class_id)
  );

-- SURVEY_TEMPLATES TABLE POLICIES
-- Staff can read templates from their own classes or global templates if they are staff in ANY class
CREATE POLICY survey_templates_select ON survey_templates
  FOR SELECT
  USING (
    authorizeforclassgrader(survey_templates.class_id) 
    OR 
    (scope = 'global' AND authorizeforanyclassstaff())
  );

-- Staff (instructors and graders) can do everything on survey templates
CREATE POLICY survey_templates_all_staff ON survey_templates
  FOR ALL
  USING (authorizeforclassgrader(survey_templates.class_id))
  WITH CHECK (authorizeforclassgrader(survey_templates.class_id));

-- Creator can delete survey templates
CREATE POLICY survey_templates_delete ON survey_templates
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.private_profile_id = survey_templates.created_by
    )
  );

-- SURVEY_RESPONSES TABLE POLICIES
-- Staff (instructors and graders) can do everything on survey responses
CREATE POLICY survey_responses_all_staff ON survey_responses
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.surveys s
      WHERE s.id = survey_responses.survey_id
        AND authorizeforclassgrader(s.class_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.surveys s
      WHERE s.id = survey_responses.survey_id
        AND authorizeforclassgrader(s.class_id)
    )
  );

-- Students can only select and update their own responses
CREATE POLICY survey_responses_select_owner ON survey_responses
  FOR SELECT
  USING (authorizeforprofile(survey_responses.profile_id));

CREATE POLICY survey_responses_update_owner ON survey_responses
  FOR UPDATE
  USING (authorizeforprofile(survey_responses.profile_id))
  WITH CHECK (authorizeforprofile(survey_responses.profile_id));

-- PEER_SURVEYS TABLE POLICIES
-- Staff (instructors and graders) can do everything on peer_surveys
CREATE POLICY peer_surveys_all_staff ON peer_surveys
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.survey_responses sr
      JOIN public.surveys s ON s.id = sr.survey_id
      WHERE sr.id = peer_surveys.survey_response_id
        AND authorizeforclassgrader(s.class_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.survey_responses sr
      JOIN public.surveys s ON s.id = sr.survey_id
      WHERE sr.id = peer_surveys.survey_response_id
        AND authorizeforclassgrader(s.class_id)
    )
  );

-- Students can see peer_survey entries where the related survey_response has their profile_id
CREATE POLICY peer_surveys_select_students ON peer_surveys
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.survey_responses sr
      JOIN public.user_roles ur ON ur.private_profile_id = sr.profile_id
      WHERE sr.id = peer_surveys.survey_response_id
        AND ur.user_id = auth.uid()
        AND ur.disabled = false
    )
  );

