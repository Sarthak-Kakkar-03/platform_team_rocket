import { createClient } from "@/utils/supabase/client";
import { ResponseData, SurveyResponse } from "@/types/survey";

export async function saveResponse(
  surveyId: string,
  profileID: string,
  responseData: ResponseData,
  isSubmitted: boolean = false
) {
  const supabase = createClient();

  try {
    // Check if response already exists (students can only UPDATE, not INSERT)
    const existingResponse = await getResponse(surveyId, profileID);

    if (!existingResponse) {
      throw new Error("Survey response not found. Responses must be created by the system first.");
    }

    // Update existing response
    // Set submitted_at timestamp when submitting
    const updateData: {
      response: ResponseData;
      is_submitted: boolean;
      submitted_at?: string;
    } = {
      response: responseData,
      is_submitted: isSubmitted
    };

    // Set submitted_at timestamp when isSubmitted is true (only if not already set)
    if (isSubmitted && !existingResponse.submitted_at) {
      updateData.submitted_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from("survey_responses")
      .update(updateData)
      .eq("survey_id", surveyId)
      .eq("profile_id", profileID)
      .select()
      .single();

    if (error) {
      console.error("Database error saving response:", error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error("Exception saving response:", error);
    throw error;
  }
}

export async function getResponse(surveyId: string, profileID: string): Promise<SurveyResponse | null> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase
      .from("survey_responses")
      .select("*")
      .eq("survey_id", surveyId)
      .eq("profile_id", profileID)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("getResponse error:", error);
      throw error;
    }

    return (data ?? null) as SurveyResponse | null;
  } catch (error) {
    console.error("Error getting response:", error);
    throw error;
  }
}

// not even being used though, can we delete ?
export async function getAllResponses(surveyId: string, classId: number) {
  const supabase = createClient();

  try {
    // First, get the survey responses
    const { data: responses, error: responsesError } = await supabase
      .from("survey_responses")
      .select("*")
      .eq("survey_id", surveyId)
      .order("submitted_at", { ascending: false });

    if (responsesError) {
      console.error("Error getting survey responses:", responsesError);
      throw responsesError;
    }

    if (!responses || responses.length === 0) {
      return [];
    }

    // Get the profile_ids from responses
    const profileIds = responses.map((r) => r.profile_id);

    // Get user_roles to map profile -> profile data (and optionally user_id)
    // We assume survey_responses.profile_id corresponds to user_roles.private_profile_id
    const { data: userRoles, error: userRolesError } = await supabase
      .from("user_roles")
      .select(
        `
        user_id,
        private_profile_id,
        profiles:private_profile_id (
          id,
          name,
          sis_user_id
        )
      `
      )
      .eq("class_id", classId)
      .in("private_profile_id", profileIds); // ✅ was in("user_id", ...)

    if (userRolesError) {
      console.error("Error getting user roles:", userRolesError);
      throw userRolesError;
    }

    // Create a map of profile_id -> profile data
    const profileMap = new Map();
    userRoles?.forEach((role) => {
      profileMap.set(role.private_profile_id, role.profiles);
    });

    // Combine responses with profile data
    const responsesWithProfiles = responses.map((response) => ({
      ...response,
      profiles: profileMap.get(response.profile_id) || {
        id: response.profile_id,
        name: "Unknown Student",
        sis_user_id: null
      }
    }));

    return responsesWithProfiles;
  } catch (error) {
    console.error("Error getting all responses:", error);
    throw error;
  }
}

export async function deleteResponse(responseId: string) {
  const supabase = createClient();

  try {
    const { error } = await supabase.from("survey_responses").delete().eq("id", responseId);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    console.error("Error deleting response:", error);
    throw error;
  }
}
