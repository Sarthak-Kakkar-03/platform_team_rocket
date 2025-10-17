// lists all surveys for this course ID
// students (and maybe TAs) see this page

import { Container, Heading, Text, VStack, Box } from "@chakra-ui/react";

type SurveysPageProps = {
  params: Promise<{ course_id: string }>;
};

export default async function SurveysPage({ params }: SurveysPageProps) {
  const { course_id } = await params;

  return (
    <Container py={8}>
      <VStack align="stretch" gap={8}>
        {/* Header */}
        <Box textAlign="center" mb={4}>
          <Heading size="2xl" mb={4}>
            Surveys
          </Heading>
          <Text fontSize="lg" mx="auto">
            View and complete course surveys
          </Text>
        </Box>

        {/* Placeholder */}
        <VStack align="center" justify="center" minH="400px" gap={6} borderRadius="2xl" p={12} border="2px dashed">
          <VStack gap={3}>
            <Heading size="lg">No surveys yet</Heading>
            <Text fontSize="lg" textAlign="center">
              Surveys will appear here when they are available.
            </Text>
            <Text fontSize="md" textAlign="center" color="gray.500">
              Course ID: {course_id}
            </Text>
          </VStack>
        </VStack>
      </VStack>
    </Container>
  );
}