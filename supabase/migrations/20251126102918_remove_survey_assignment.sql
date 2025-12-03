-- Migration: Remove survey_assignments table and use survey_responses for specific student assignments
-- Instead of a separate tracking table, we pre-create survey_responses with is_submitted=false for specific students

-- Drop the create_survey_assignments function
DROP FUNCTION IF EXISTS create_survey_assignments(UUID, UUID[]);

-- Drop the survey_assignments table
DROP TABLE IF EXISTS survey_assignments CASCADE;

-- Drop the survey_assignees table
DROP TABLE IF EXISTS survey_assignees CASCADE;

-- Remove the assigned_to_all column from surveys (we use survey_type enum now)
ALTER TABLE surveys DROP COLUMN IF EXISTS assigned_to_all;

-- Create a function to pre-create survey_responses for specific students
-- This creates empty response rows with is_submitted=false
CREATE OR REPLACE FUNCTION create_survey_response_assignments(
  p_survey_id UUID,
  p_profile_ids UUID[]
)
RETURNS void AS $$
DECLARE
  v_class_id BIGINT;
BEGIN
  -- Verify the caller is an instructor for this survey's class
  SELECT class_id INTO v_class_id
  FROM public.surveys
  WHERE id = p_survey_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Survey not found';
  END IF;
  
  IF NOT authorizeforclassinstructor(v_class_id) THEN
    RAISE EXCEPTION 'Permission denied: only instructors can manage survey assignments';
  END IF;
  
  -- Delete existing unsubmitted responses for this survey (to handle reassignment)
  DELETE FROM survey_responses 
  WHERE survey_id = p_survey_id 
    AND is_submitted = FALSE;
  
  -- Insert new response assignments (pre-created with is_submitted=false)
  INSERT INTO survey_responses (survey_id, profile_id, response, is_submitted)
  SELECT p_survey_id, unnest(p_profile_ids), '{}'::jsonb, FALSE
  ON CONFLICT (survey_id, profile_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION create_survey_response_assignments(UUID, UUID[]) TO authenticated;

-- Add comment
COMMENT ON FUNCTION create_survey_response_assignments IS 'Pre-create empty survey_responses for specific students. Only callable by instructors.';

-- Create a function to pre-create survey_responses for ALL students in a class
-- Used when survey_type = 'assign_all'
CREATE OR REPLACE FUNCTION create_survey_responses_for_all_students(
  p_survey_id UUID
)
RETURNS void AS $$
DECLARE
  v_class_id BIGINT;
BEGIN
  -- Get the class_id for this survey and verify it exists
  SELECT class_id INTO v_class_id
  FROM public.surveys
  WHERE id = p_survey_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Survey not found';
  END IF;
  
  IF NOT authorizeforclassinstructor(v_class_id) THEN
    RAISE EXCEPTION 'Permission denied: only instructors can manage survey assignments';
  END IF;
  
  -- Delete existing unsubmitted responses for this survey (to handle republishing)
  DELETE FROM survey_responses 
  WHERE survey_id = p_survey_id 
    AND is_submitted = FALSE;
  
  -- Insert survey_responses for all students in the class
  -- Uses private_profile_id from user_roles where role = 'student'
  INSERT INTO survey_responses (survey_id, profile_id, response, is_submitted)
  SELECT p_survey_id, ur.private_profile_id, '{}'::jsonb, FALSE
  FROM public.user_roles ur
  WHERE ur.class_id = v_class_id
    AND ur.role = 'student'
    AND ur.private_profile_id IS NOT NULL
  ON CONFLICT (survey_id, profile_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION create_survey_responses_for_all_students(UUID) TO authenticated;

-- Add comment
COMMENT ON FUNCTION create_survey_responses_for_all_students IS 'Pre-create empty survey_responses for all students in the class. Only callable by instructors.';