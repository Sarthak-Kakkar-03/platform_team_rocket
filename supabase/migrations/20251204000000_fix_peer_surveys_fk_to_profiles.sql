-- Fix peer_surveys foreign key to reference profiles instead of user_roles
-- Drop the existing foreign key constraint
ALTER TABLE peer_surveys 
  DROP CONSTRAINT IF EXISTS peer_surveys_target_private_profile_id_fkey;

-- Add new foreign key constraint referencing profiles(id)
ALTER TABLE peer_surveys 
  ADD CONSTRAINT peer_surveys_target_private_profile_id_fkey 
  FOREIGN KEY (target_private_profile_id) 
  REFERENCES profiles(id);

