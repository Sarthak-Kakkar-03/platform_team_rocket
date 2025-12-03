-- RLS policy for peer_surveys to allow students to see entries for survey_responses assigned to them
-- Students can see peer_survey entries where the related survey_response has their profile_id

-- Create policy for students to view peer_surveys for their assigned survey_responses
CREATE POLICY peer_surveys_select_students ON peer_surveys
  FOR SELECT
  USING (
    -- Check if the current user has a survey_response with this profile_id
    EXISTS (
      SELECT 1
      FROM public.survey_responses sr
      JOIN public.user_roles ur ON ur.private_profile_id = sr.profile_id
      WHERE sr.id = peer_surveys.survey_response_id
        AND ur.user_id = auth.uid()
        AND ur.disabled = false
    )
  );

