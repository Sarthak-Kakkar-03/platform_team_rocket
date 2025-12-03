-- Fix peer_surveys to use private_profile_id instead of public_profile_id
-- Drop the existing foreign key constraint
ALTER TABLE peer_surveys 
  DROP CONSTRAINT IF EXISTS peer_surveys_target_public_profile_id_fkey;

-- Rename the column
ALTER TABLE peer_surveys 
  RENAME COLUMN target_public_profile_id TO target_private_profile_id;

-- Add new foreign key constraint referencing user_roles(private_profile_id)
ALTER TABLE peer_surveys 
  ADD CONSTRAINT peer_surveys_target_private_profile_id_fkey 
  FOREIGN KEY (target_private_profile_id) 
  REFERENCES user_roles(private_profile_id);
