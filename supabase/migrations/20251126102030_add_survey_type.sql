--TODO: Remove survey_assignments table and related functions and dependencies 
CREATE TYPE survey_type AS ENUM ('assign_all', 'specific_students', 'peer_review');
ALTER TABLE IF EXISTS surveys ADD COLUMN IF NOT EXISTS survey_type survey_type NOT NULL DEFAULT 'assign_all';