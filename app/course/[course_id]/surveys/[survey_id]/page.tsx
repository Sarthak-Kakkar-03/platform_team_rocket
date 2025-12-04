"use client";

import { Box, Heading, Text, VStack, Button } from "@chakra-ui/react";
import { useColorModeValue } from "@/components/ui/color-mode";
import { createClient } from "@/utils/supabase/client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { toaster } from "@/components/ui/toaster";
import dynamic from "next/dynamic";
import { saveResponse, getResponse } from "./submit";
import { useClassProfiles } from "@/hooks/useClassProfiles";
import { Survey, SurveyResponse } from "@/types/survey";
import { Model, ValueChangedEvent } from "survey-core";

const SurveyComponent = dynamic(() => import("@/components/Survey"), {
  ssr: false,
  loading: () => (
    <Box display="flex" alignItems="center" justifyContent="center" p={8}>
      <Text>Loading survey...</Text>
    </Box>
  )
});

export default function SurveyTakingPage() {
  const { course_id, survey_id } = useParams();
  const router = useRouter();

  // pulls from ClassProfileProvider
  const { private_profile_id } = useClassProfiles();

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [existingResponse, setExistingResponse] = useState<SurveyResponse | null>(null);
  const [targetProfileName, setTargetProfileName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setIsSubmitting] = useState(false);

  // Color mode values
  const textColor = useColorModeValue("#000000", "#FFFFFF");
  const borderColor = useColorModeValue("#D2D2D2", "#2D2D2D");
  const cardBgColor = useColorModeValue("#E5E5E5", "#1A1A1A");

  useEffect(() => {
    const loadSurveyData = async () => {
      try {
        const supabase = createClient();

        // Get current user
        const {
          data: { user }
        } = await supabase.auth.getUser();
        if (!user) {
          toaster.create({
            title: "Authentication Required",
            description: "Please log in to take surveys.",
            type: "error"
          });
          router.push(`/course/${course_id}/surveys`);
          return;
        }

        // If we somehow don't have a profile for this class context, bail early
        if (!private_profile_id) {
          toaster.create({
            title: "Access Error",
            description: "We couldn't find your course profile.",
            type: "error"
          });
          router.push(`/course/${course_id}/surveys`);
          return;
        }

        // Get survey data
        const { data: surveyDataRaw, error: surveyError } = await supabase
          .from("surveys")
          .select("*")
          .eq("id", survey_id as string)
          .eq("class_id", Number(course_id))
          .eq("status", "published")
          .single();

        const surveyData = surveyDataRaw as Survey | null;

        if (surveyError || !surveyData) {
          toaster.create({
            title: "Survey Not Found",
            description: "This survey is not available or has been removed.",
            type: "error"
          });
          router.push(`/course/${course_id}/surveys`);
          return;
        }

        setSurvey(surveyData);

        // Get existing response if any
        const response = await getResponse(surveyData.id, private_profile_id);
        setExistingResponse(response || null);

        // If this is a peer survey, fetch the target profile name
        if (surveyData.survey_type === "peer_review") {
          if (response) {
            // Get peer_survey entry for this response to find the target
            const { data: peerSurveyData, error: peerSurveyError } = await supabase
              .from("peer_surveys")
              .select("target_private_profile_id")
              .eq("survey_response_id", response.id)
              .single();

            if (!peerSurveyError && peerSurveyData?.target_private_profile_id) {
              // Get the target profile name (profiles has class_id, so filter by both id and class_id for RLS)
              const { data: targetProfile, error: targetProfileError } = await supabase
                .from("profiles")
                .select("name")
                .eq("id", peerSurveyData.target_private_profile_id)
                .eq("class_id", Number(course_id))
                .single();

              if (!targetProfileError && targetProfile?.name) {
                setTargetProfileName(targetProfile.name);
              } else {
                // Set placeholder if name cannot be loaded
                console.error("Error loading target profile:", targetProfileError);
                setTargetProfileName("Name error");
              }
            } else {
              // Set placeholder if peer survey data cannot be loaded
              setTargetProfileName("Name error");
            }
          } else {
            // Set placeholder if response doesn't exist yet
            setTargetProfileName("Name error");
          }
        }
      } catch (error) {
        console.error("Error loading survey:", error);
        toaster.create({
          title: "Error Loading Survey",
          description: "An error occurred while loading the survey.",
          type: "error"
        });
        router.push(`/course/${course_id}/surveys`);
      } finally {
        setIsLoading(false);
      }
    };

    loadSurveyData();
  }, [course_id, survey_id, private_profile_id, router]); // Include router in dependencies

  const handleSurveyComplete = useCallback(
    async (surveyModel: Model) => {
      if (!private_profile_id || !survey) {
        console.error("Cannot submit survey: Missing profile_id or survey");
        return;
      }

      // Extract only the survey data from the model, not the entire model object
      const surveyData = surveyModel.data;

      setIsSubmitting(true);
      try {
        await saveResponse(survey.id, private_profile_id, surveyData, true);

        toaster.create({
          title: "Survey Submitted",
          description: "Your survey has been submitted successfully.",
          type: "success"
        });

        // Redirect back to surveys list
        router.push(`/course/${course_id}/surveys`);
      } catch (error) {
        console.error("Error submitting survey:", error);

        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
        toaster.create({
          title: "Submission Failed",
          description: `Error: ${errorMessage}. Please try again.`,
          type: "error"
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [private_profile_id, survey, course_id, router]
  );

  const handleValueChanged = useCallback(
    async (surveyModel: Model, options?: ValueChangedEvent) => {
      void options;
      if (!private_profile_id || !survey || !survey.allow_response_editing) return;

      // Extract only the survey data from the model, not the entire model object
      const surveyData = surveyModel.data;

      // Auto-save on value change if editing is allowed
      try {
        await saveResponse(survey.id, private_profile_id, surveyData, false);
      } catch (error) {
        console.error("Error auto-saving response:", error);
        // Don't show error toast for auto-save failures to avoid spam
      }
    },
    [private_profile_id, survey]
  );

  const handleBackToSurveys = useCallback(() => {
    router.push(`/course/${course_id}/surveys`);
  }, [router, course_id]);

  if (isLoading) {
    return (
      <Box py={8} maxW="1200px" my={2} mx="auto">
        <Box display="flex" alignItems="center" justifyContent="center" p={8}>
          <Text color={textColor}>Loading survey...</Text>
        </Box>
      </Box>
    );
  }

  if (!survey) {
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
                Survey Not Found
              </Heading>
              <Text color={textColor} textAlign="center">
                This survey is not available or has been removed.
              </Text>
              <Button
                variant="outline"
                bg="transparent"
                borderColor="border.emphasized"
                color="fg.muted"
                _hover={{ bg: "gray.subtle" }}
                onClick={handleBackToSurveys}
              >
                ← Back to Surveys
              </Button>
            </VStack>
          </Box>
        </VStack>
      </Box>
    );
  }

  // Check if survey is read-only (submitted and editing not allowed)
  const isReadOnly = existingResponse?.is_submitted && !survey.allow_response_editing;

  return (
    <Box py={8} maxW="1200px" my={2} mx="auto">
      <VStack align="stretch" gap={6} w="100%">
        {/* Header */}
        <VStack align="stretch" gap={4}>
          <Button
            variant="outline"
            size="sm"
            bg="transparent"
            borderColor="border.emphasized"
            color="fg.muted"
            _hover={{ bg: "gray.subtle" }}
            onClick={handleBackToSurveys}
            alignSelf="flex-start"
          >
            ← Back to Surveys
          </Button>

          <Heading size="xl" color={textColor} textAlign="left">
            {survey.survey_type === "peer_review"
              ? `${survey.title} - Reviewing ${targetProfileName || "Name error"}`
              : survey.title}
          </Heading>

          {survey.description && (
            <Text color={textColor} fontSize="md" opacity={0.8}>
              {survey.description}
            </Text>
          )}

          {isReadOnly && (
            <Box
              colorPalette="yellow"
              bg="yellow.subtle"
              border="1px solid"
              borderColor="yellow.emphasized"
              borderRadius="md"
              p={3}
            >
              <Text color="yellow.fg" fontSize="sm" fontWeight="medium">
                This survey has been submitted and cannot be edited.
              </Text>
            </Box>
          )}

          {existingResponse?.is_submitted && survey.allow_response_editing && (
            <Box
              colorPalette="green"
              bg="green.subtle"
              border="1px solid"
              borderColor="green.emphasized"
              borderRadius="md"
              p={3}
            >
              <Text color="green.fg" fontSize="sm" fontWeight="medium">
                You can edit your response since editing is allowed for this survey.
              </Text>
            </Box>
          )}
        </VStack>

        {/* Survey */}
        <Box w="100%" bg={cardBgColor} border="1px solid" borderColor={borderColor} borderRadius="lg" p={8}>
          <SurveyComponent
            surveyJson={survey.json}
            initialData={existingResponse?.response}
            readOnly={isReadOnly}
            onComplete={handleSurveyComplete}
            onValueChanged={handleValueChanged}
            isPopup={false}
          />
        </Box>
      </VStack>
    </Box>
  );
}
