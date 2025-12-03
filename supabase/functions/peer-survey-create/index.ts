// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { assertUserIsInCourse, wrapRequestHandler, UserVisibleError, IllegalArgumentError } from "../_shared/HandlerUtils.ts";

//Function for creating a peer survey
//assignment_id: -1 for all groups, 0 throws error, >0 for a specific assignment
export type PeerSurveyRequest = {
  class_id: number;
  assignment_id: number;
  title: string;
  description: string;
  survey_json: string;
  due_date: string;
};

//helper function to get groups
async function getGroups(class_id: number, supabase: any, assignment_id: number) {
  let groups;

  if (assignment_id == -1) {
    const { data: newest_assignment, error: assignmentError } = await supabase
      .from("assignments")
      .select("id")
      .eq("class_id", class_id)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (assignmentError || !newest_assignment) {
      throw new UserVisibleError("No assignments found for this course. Please create an assignment first.", 404);
    }

    const { data, error: groupsError } = await supabase
      .from("assignment_groups")
      .select("*")
      .eq("class_id", class_id)
      .eq("assignment_id", newest_assignment.id);

    if (groupsError) {
      throw new UserVisibleError(`Failed to fetch groups: ${groupsError.message}`, 500);
    }

    groups = data;
  } else if (assignment_id > 0) {
    const { data, error: groupsError } = await supabase
      .from("assignment_groups")
      .select("*")
      .eq("class_id", class_id)
      .eq("assignment_id", assignment_id);

    if (groupsError) {
      throw new UserVisibleError(`Failed to fetch groups: ${groupsError.message}`, 500);
    }

    groups = data;
  } else {
    throw new IllegalArgumentError("Invalid assignment_id");
  }

  if (!groups || groups.length === 0) {
    throw new UserVisibleError("No groups found for this course", 404);
  }
  return groups;
}

async function createPeerSurveyForGroup(group_id: number, supabase: any, survey_id: string) {
  //get all the members of the group
  const { data: profile_ids, error: membersError } = await supabase
    .from("assignment_groups_members")
    .select("profile_id")
    .eq("assignment_group_id", group_id);

  if (membersError) {
    throw new UserVisibleError(`Failed to fetch group members: ${membersError.message}`, 500);
  }

  if (!profile_ids || profile_ids.length === 0) {
    throw new UserVisibleError("No members found for this group", 404);
  }

  for (const profile_id of profile_ids) {
    for (const profile_id2 of profile_ids) {
      if (profile_id.profile_id !== profile_id2.profile_id) {
        //create a peer survey-response entry for target:profile_id2 response:profile_id
        const { data: peer_survey_response, error: responseError } = await supabase
          .from("survey_responses")
          .insert({ survey_id: survey_id, profile_id: profile_id.profile_id })
          .select("id")
          .single();

        if (responseError) {
          throw new UserVisibleError(`Failed to create peer survey response: ${responseError.message}`, 500);
        }

        if (!peer_survey_response) {
          throw new UserVisibleError("Failed to create peer survey response", 500);
        }

        //create peer_surveys entry for target:profile_id2 response:profile_id
        const { data: peer_survey, error: peerSurveyError } = await supabase
          .from("peer_surveys")
          .insert({ 
            target_private_profile_id: profile_id2.profile_id, 
            survey_response_id: peer_survey_response.id 
          })
          .select()
          .single();

        if (peerSurveyError) {
          console.error("Peer survey insert error:", {
            error: peerSurveyError,
            code: peerSurveyError.code,
            message: peerSurveyError.message,
            details: peerSurveyError.details,
            hint: peerSurveyError.hint,
            target_private_profile_id: profile_id2.profile_id,
            survey_response_id: peer_survey_response.id
          });
          throw new UserVisibleError(
            `Failed to create peer_surveys entry: ${peerSurveyError.message || peerSurveyError.details || "Unknown error"}`,
            500
          );
        }

        if (!peer_survey) {
          console.error("Peer survey insert returned null:", {
            target_private_profile_id: profile_id2.profile_id,
            survey_response_id: peer_survey_response.id
          });
          throw new UserVisibleError("Failed to create peer_surveys entry: Insert returned no data", 500);
        }
      }
    }
  }
}

async function handleRequest(req: Request) {
  const { class_id, assignment_id, title, description, survey_json, due_date } = await req.json();
  const { supabase, enrollment } = await assertUserIsInCourse(class_id, req.headers.get("Authorization")!);

  if (!enrollment || !enrollment.private_profile_id) {
    throw new UserVisibleError("Unable to determine user profile", 500);
  }

  //get groups
  const groups = await getGroups(class_id, supabase, assignment_id);
  if (!groups) {
    throw new UserVisibleError("No groups found for this course", 404);
  }

  //create survey
  const { data: survey, error: surveyError } = await supabase
    .from("surveys")
    .insert({
      class_id: class_id,
      created_by: enrollment.private_profile_id,
      json: survey_json,
      title: title,
      description: description,
      due_date: due_date,
      survey_type: "peer_review",
      status: "published"
    })
    .select("id, survey_id")
    .single();

  if (surveyError) {
    console.error("Survey creation error:", surveyError);
    throw new UserVisibleError(`Failed to create survey: ${surveyError.message}`, 500);
  }

  if (!survey) {
    throw new UserVisibleError("Failed to create survey", 500);
  }

  //assign peer survey for each group
  // If any group fails, rollback by deleting the survey
  try {
    for (const group of groups) {
      await createPeerSurveyForGroup(group.id, supabase, survey.id);
    }
  } catch (error) {
    // Rollback: delete the survey if peer survey creation fails
    console.error("Peer survey creation failed, rolling back survey:", error);
    const { error: deleteError } = await supabase
      .from("surveys")
      .delete()
      .eq("id", survey.id);

    if (deleteError) {
      console.error("Failed to delete survey during rollback:", deleteError);
      // Still throw the original error, but log the cleanup failure
    }

    // Re-throw the original error
    throw error;
  }

  return {
    success: true,
    survey_id: survey.survey_id
  };
}

Deno.serve(async (req) => {
  return await wrapRequestHandler(req, handleRequest);
});
