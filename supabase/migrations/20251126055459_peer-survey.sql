CREATE TABLE IF NOT EXISTS peer_surveys (
    target_public_profile_id UUID NOT NULL REFERENCES user_roles(public_profile_id),
    survey_response_id UUID NOT NULL REFERENCES survey_responses(id)
);



