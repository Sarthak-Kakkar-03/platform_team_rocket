import { Container } from "@chakra-ui/react";
import { createClient } from "@/utils/supabase/server";
import SurveysTable from "./SurveysTable";
import EmptySurveysState from "./EmptySurveysState";
import SurveysHeader from "./SurveysHeader";
import type { Survey } from "@/types/survey";

type ManageSurveysPageProps = {
  params: Promise<{ course_id: string }>;
};

export default async function ManageSurveysPage({ params }: ManageSurveysPageProps) {
  const { course_id } = await params;
  const supabase = await createClient();

  // Fetch class data for timezone
  const { data: classData } = await supabase.from("classes").select("time_zone").eq("id", Number(course_id)).single();

  const timezone = classData?.time_zone || "America/New_York";

  // Fetch surveys for this course (excluding soft-deleted)
  const { data: surveys, error } = await supabase
    .from("surveys")
    .select("*")
    .eq("class_id", Number(course_id))
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching surveys:", error);
  }

  // Fetch response counts and assigned student counts for each survey
  // Both counts come from survey_responses table:
  // - assigned_student_count: total entries in survey_responses (is_submitted true or false)
  // - response_count: entries where is_submitted = true
  const surveysWithCounts = await Promise.all(
    (surveys || []).map(async (survey: Survey) => {
      // Get total assigned (all survey_responses entries)
      const { count: assignedCount } = await supabase
        .from("survey_responses")
        .select("*", { count: "exact", head: true })
        .eq("survey_id", survey.id)
        .is("deleted_at", null);

      // Get submitted count (is_submitted = true)
      const { count: submittedCount } = await supabase
        .from("survey_responses")
        .select("*", { count: "exact", head: true })
        .eq("survey_id", survey.id)
        .eq("is_submitted", true)
        .is("deleted_at", null);

      return {
        ...survey,
        response_count: submittedCount || 0,
        submitted_count: submittedCount || 0,
        assigned_student_count: assignedCount || 0
      };
    })
  );

  // Show empty state if no surveys
  if (!surveys || surveys.length === 0) {
    return <EmptySurveysState courseId={course_id} />;
  }

  // Show table with surveys
  return (
    <Container py={8} maxW="1200px" my={2}>
      <SurveysHeader courseId={course_id} />

      <SurveysTable surveys={surveysWithCounts} courseId={course_id} timezone={timezone} />
    </Container>
  );
}
