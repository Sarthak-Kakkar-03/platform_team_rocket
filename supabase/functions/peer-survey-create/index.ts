// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { assertUserIsInCourse, wrapRequestHandler } from "../_shared/HandlerUtils.ts";

//Function for creating a peer survey 
//assignment_id: -1 for all groups, 0 throws error, >0 for a specific assignment
export type PeerSurveyRequest = {
  class_id: number,
  assignment_id: number,
  title: string,
  description: string,
  survey_json: string,
  due_date: string,
}

//helper function to get groups 
async function getGroups(class_id: number, supabase: any, assignment_id: number) {
  let groups;
  
  if (assignment_id == -1) {
    const { data } = await supabase.from("assignment_groups").select("*").eq("class_id", class_id);
    groups = data;
  }
  else if (assignment_id > 0) {
    const { data } = await supabase.from("assignment_groups").select("*").eq("class_id", class_id).eq("assignment_id", assignment_id);
    groups = data;
  }
  else {
    throw new Error("Invalid assignment_id");
  }

  if (!groups || groups.length === 0) {
    throw new Error("No groups found for this course");
  }
  return groups;
}

async function createPeerSurveyForGroup(group_id: number, supabase: any, survey_id: string) {
  //get all the members of the group
  const { data: profile_ids } = await supabase.from("assignment_groups_members").select("profile_id").eq("group_id", group_id);
  if (!profile_ids || profile_ids.length === 0) {
    throw new Error("No members found for this group");
  }

  for (const profile_id of profile_ids) {
    for (const profile_id2 of profile_ids) {
      if (profile_id.profile_id !== profile_id2.profile_id) {
        //create a peer survey-response entry for target:profile_id2 response:profile_id
        const { data: peer_survey_response } = await supabase.from("survey_responses")
          .insert({ survey_id: survey_id, profile_id: profile_id.profile_id }).select("id").single();
        if (!peer_survey_response) {
          throw new Error("Failed to create peer survey response");
        }
        //create peer_surveys entry for target:profile_id2 response:profile_id
        const { data: peer_survey } = await supabase.from("peer_surveys")
          .insert({ target_public_profile_id: profile_id2.profile_id, survey_response_id: peer_survey_response.id });
        if (!peer_survey) {
          throw new Error("Failed to create peer_surveys entry");
        }
      }
    }
  }
}

async function handleRequest(req: Request) {
  const { class_id, assignment_id, title, description, survey_json, due_date } = await req.json();
  const { supabase } = await assertUserIsInCourse(class_id, req.headers.get("Authorization")!);

  //get groups
  const groups = await getGroups(class_id, supabase, assignment_id);
  if (!groups) {
    throw new Error("No groups found for this course");
  }

  //create survey
  const { data: survey } = await supabase.from("surveys").insert({
    class_id: class_id,
    json: survey_json,
    title: title,
    description: description,
    due_date: due_date,
    assigned_to_all: false,
  }).select("id").single();
  
  if (!survey) {
    throw new Error("Failed to create survey");
  }

  //assign peer survey for each group
  for (const group of groups) {
    await createPeerSurveyForGroup(group.id, supabase, survey.id);
  }
  
  return {
    success: true,
    survey_id: survey.id,
  };
}


Deno.serve(async (req) => {
  return await wrapRequestHandler(req, handleRequest);
});
