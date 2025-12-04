"use client";

import { Box, Heading, Text, VStack, HStack, Badge, Button } from "@chakra-ui/react";
import { useColorModeValue } from "@/components/ui/color-mode";
import { createClient } from "@/utils/supabase/client";
import { useParams } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import { toaster } from "@/components/ui/toaster";
import Link from "@/components/ui/link";
import { formatInTimeZone } from "date-fns-tz";
import { SurveyWithResponse } from "@/types/survey";
import SurveyFilterButtons from "@/components/survey/SurveyFilterButtons";
import { useClassProfiles } from "@/hooks/useClassProfiles";
import useAuthState from "@/hooks/useAuthState";

type FilterType = "all" | "not_started" | "completed";

export default function StudentSurveysPage() {
  const { course_id } = useParams();
  const { private_profile_id } = useClassProfiles();
  const { user } = useAuthState();
  const [surveys, setSurveys] = useState<SurveyWithResponse[]>([]);
  const [targetProfileNames, setTargetProfileNames] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");

  // Color mode values
  const textColor = useColorModeValue("#000000", "#FFFFFF");
  const borderColor = useColorModeValue("#D2D2D2", "#2D2D2D");
  const cardBgColor = useColorModeValue("#E5E5E5", "#1A1A1A");

  // Status badge configuration
  const statusColors = {
    not_started: {
      colorPalette: "red",
      text: "Not Started"
    },
    in_progress: {
      colorPalette: "red",
      text: "In Progress"
    },
    completed: {
      colorPalette: "green",
      text: "Completed"
    }
  };

  useEffect(() => {
    const loadSurveys = async () => {
      if (!user || !private_profile_id) {
        setIsLoading(false);
        return;
      }

      try {
        const supabase = createClient();
        // Get this profile's survey responses (students can only see their own responses)
        const { data: responsesData, error: responsesError } = await supabase
          .from("survey_responses")
          .select("*")
          .eq("profile_id", private_profile_id);

        if (responsesError) {
          throw responsesError;
        }

        // If there are no responses, there are no surveys to show
        if (!responsesData || responsesData.length === 0) {
          setSurveys([]);
          setIsLoading(false);
          return;
        }

        // Get unique survey IDs from responses
        const surveyIds = [...new Set(responsesData.map((r) => r.survey_id))];

        // Get surveys associated with these responses (only published and not deleted)
        const { data: surveysData, error: surveysError } = await supabase
          .from("surveys")
          .select("*")
          .in("id", surveyIds)
          .eq("class_id", Number(course_id))
          .eq("status", "published")
          .is("deleted_at", null)
          .order("created_at", { ascending: false });

        if (surveysError) {
          throw surveysError;
        }

        // If no surveys found (shouldn't happen, but handle gracefully)
        if (!surveysData || surveysData.length === 0) {
          setSurveys([]);
          setIsLoading(false);
          return;
        }

        // Merge surveys with the current profile's response status
        const surveysWithResponse: SurveyWithResponse[] = surveysData.map((survey) => {
          const response = responsesData.find((r) => r.survey_id === survey.id);

          let response_status: "not_started" | "in_progress" | "completed" = "not_started";
          if (response) {
            if (response.is_submitted) {
              response_status = "completed";
            } else {
              // Check if response JSON is empty (no progress saved)
              const responseJson = response.response as Record<string, unknown> | null | undefined;
              const isEmpty =
                !responseJson || (typeof responseJson === "object" && Object.keys(responseJson).length === 0);

              response_status = isEmpty ? "not_started" : "in_progress";
            }
          }

          return {
            ...survey,
            response_status,
            submitted_at: response?.submitted_at,
            is_submitted: response?.is_submitted
          };
        });

        setSurveys(surveysWithResponse);

        // For peer surveys, fetch target profile names using JOIN
        const peerSurveys = surveysWithResponse.filter((s) => s.survey_type === "peer_review");
        if (peerSurveys.length > 0) {
          const targetProfileNamesMap = new Map<string, string>();
          const peerSurveyResponses = responsesData?.filter((r) => peerSurveys.some((ps) => ps.id === r.survey_id));

          if (peerSurveyResponses && peerSurveyResponses.length > 0) {
            const responseIds = peerSurveyResponses.map((r) => r.id);

            // JOIN peer_surveys with profiles and survey_responses in a single query
            const { data: peerSurveyData, error: peerSurveyError } = await supabase
              .from("peer_surveys")
              .select(
                `
                survey_response_id,
                profiles!inner(id, name),
                survey_responses!inner(survey_id)
              `
              )
              .in("survey_response_id", responseIds)
              .eq("profiles.class_id", Number(course_id));

            if (!peerSurveyError && peerSurveyData) {
              // Map results: survey_id -> profile name
              peerSurveyData.forEach((item) => {
                const surveyId = (item.survey_responses as { survey_id: string }).survey_id;
                const profile = item.profiles as unknown as { name: string } | null;
                const profileName = profile?.name;
                if (surveyId && profileName) {
                  targetProfileNamesMap.set(surveyId, profileName);
                }
              });
            }

            // Set placeholder for any peer surveys without data
            peerSurveyResponses.forEach((response) => {
              if (!targetProfileNamesMap.has(response.survey_id)) {
                targetProfileNamesMap.set(response.survey_id, "Name error");
              }
            });
          }

          setTargetProfileNames(targetProfileNamesMap);
        }
      } catch (error) {
        console.error("Error loading surveys:", error);
        toaster.create({
          title: "Error Loading Surveys",
          description: "An error occurred while loading surveys.",
          type: "error"
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadSurveys();
  }, [course_id, user, private_profile_id]);

  const getStatusBadge = (survey: SurveyWithResponse) => {
    const status = statusColors[survey.response_status];

    return (
      <Badge
        colorPalette={status.colorPalette}
        bg={`${status.colorPalette}.subtle`}
        color={`${status.colorPalette}.fg`}
        px={2}
        py={1}
        borderRadius="md"
        fontSize="sm"
        fontWeight="medium"
      >
        {status.text}
      </Badge>
    );
  };

  const formatDueDate = (dueDate: string) => {
    try {
      return formatInTimeZone(new Date(dueDate), "America/New_York", "MMM dd, yyyy 'at' h:mm a");
    } catch {
      return "Invalid date";
    }
  };

  // Filter options for student view
  const filterOptions = useMemo(
    () => [
      { value: "all" as const, label: "All" },
      { value: "not_started" as const, label: "Not Started" },
      { value: "completed" as const, label: "Completed" }
    ],
    []
  );

  const filteredSurveys = useMemo(() => {
    switch (activeFilter) {
      case "all":
        return surveys;
      case "not_started":
        // Show surveys that are not started or in progress (still available to take)
        return surveys.filter(
          (survey) => survey.response_status === "not_started" || survey.response_status === "in_progress"
        );
      case "completed":
        // Show completed surveys
        return surveys.filter((survey) => survey.response_status === "completed");
      default:
        return surveys;
    }
  }, [surveys, activeFilter]);

  if (isLoading) {
    return (
      <Box py={8} maxW="1200px" my={2} mx="auto">
        <Box display="flex" alignItems="center" justifyContent="center" p={8}>
          <Text color={textColor}>Loading surveys...</Text>
        </Box>
      </Box>
    );
  }

  if (surveys.length === 0) {
    return (
      <Box py={8} maxW="1200px" my={2} mx="auto">
        <VStack align="center" gap={6} w="100%" minH="100vh" p={8}>
          <Box
            w="100%"
            maxW="800px"
            bg={cardBgColor}
            border="1px solid"
            borderColor={borderColor}
            borderRadius="lg"
            p={8}
          >
            <VStack align="center" gap={4}>
              <Heading size="xl" color={textColor} textAlign="center">
                No Surveys Available
              </Heading>
              <Text color={textColor} textAlign="center">
                There are no published surveys available for this course at this time.
              </Text>
            </VStack>
          </Box>
        </VStack>
      </Box>
    );
  }

  return (
    <Box py={8} maxW="1200px" my={2} mx="auto">
      <VStack align="stretch" gap={6} w="100%">
        {/* Header */}
        <VStack align="stretch" gap={4}>
          <Heading size="xl" color={textColor} textAlign="left">
            Course Surveys
          </Heading>
          <Text color={textColor} fontSize="md" opacity={0.8}>
            Complete the surveys assigned to this course. Your responses help improve the learning experience.
          </Text>
        </VStack>

        {/* Filter Buttons */}
        <SurveyFilterButtons
          activeFilter={activeFilter}
          setActiveFilter={setActiveFilter}
          filterOptions={filterOptions}
          filterButtonActiveBg="blue.solid"
          filterButtonActiveColor="white"
          filterButtonInactiveBg="bg.subtle"
          filterButtonInactiveColor="fg.muted"
          filterButtonHoverBg="gray.subtle"
          tableBorderColor="border"
        />

        {/* Surveys List */}
        <VStack align="stretch" gap={4}>
          {filteredSurveys.length === 0 ? (
            <Box w="100%" bg={cardBgColor} border="1px solid" borderColor={borderColor} borderRadius="lg" p={8}>
              <VStack align="center" gap={2}>
                <Text color={textColor} fontSize="md" fontWeight="medium">
                  No surveys match the selected filter.
                </Text>
                <Text color={textColor} fontSize="sm" opacity={0.7}>
                  Try selecting a different filter option.
                </Text>
              </VStack>
            </Box>
          ) : (
            filteredSurveys.map((survey) => (
              <Box
                key={survey.id}
                w="100%"
                bg={cardBgColor}
                border="1px solid"
                borderColor={borderColor}
                borderRadius="lg"
                p={6}
              >
                <VStack align="stretch" gap={4}>
                  <HStack justify="space-between" align="start">
                    <VStack align="start" gap={2} flex={1}>
                      <Heading size="md" color={textColor}>
                        {survey.survey_type === "peer_review"
                          ? `${survey.title} - Reviewing ${targetProfileNames.get(survey.id) || "Name error"}`
                          : survey.title}
                      </Heading>
                      {survey.description && (
                        <Text color={textColor} fontSize="sm" opacity={0.8}>
                          {survey.description}
                        </Text>
                      )}
                    </VStack>
                  </HStack>

                  <HStack justify="space-between" align="center">
                    <HStack gap={4} align="center">
                      {getStatusBadge(survey)}
                      <VStack align="start" gap={1}>
                        {survey.due_date && (
                          <Text color={textColor} fontSize="sm" fontWeight="medium">
                            Due: {formatDueDate(survey.due_date)}
                          </Text>
                        )}
                        {survey.submitted_at && (
                          <Text color={textColor} fontSize="sm" opacity={0.7}>
                            Submitted: {formatDueDate(survey.submitted_at)}
                          </Text>
                        )}
                      </VStack>
                    </HStack>

                    <Link href={`/course/${course_id}/surveys/${survey.id}`}>
                      <Button
                        size="sm"
                        colorPalette={survey.response_status === "completed" ? "gray" : "green"}
                        bg={survey.response_status === "completed" ? "gray.solid" : "green.solid"}
                        color="white"
                        _hover={{
                          bg: survey.response_status === "completed" ? "gray.emphasized" : "green.emphasized"
                        }}
                      >
                        {survey.response_status === "completed"
                          ? "View Submission"
                          : survey.response_status === "in_progress"
                            ? "Continue Survey"
                            : "Start Survey"}
                      </Button>
                    </Link>
                  </HStack>
                </VStack>
              </Box>
            ))
          )}
        </VStack>
      </VStack>
    </Box>
  );
}
