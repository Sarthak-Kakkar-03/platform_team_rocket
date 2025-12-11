"use client";

import { useMemo } from "react";
import { usePollResponseCounts } from "@/hooks/useCourseController";
import { Json } from "@/utils/supabase/SupabaseTypes";
import PollBarChart from "./PollBarChart";

type MultipleChoiceDynamicViewerProps = {
  pollId: string;
  pollQuestion: Json;
};

export default function MultipleChoiceDynamicViewer({ pollId, pollQuestion }: MultipleChoiceDynamicViewerProps) {
  // Extract question title for display
  let questionPrompt = "Poll";
  
  // Type guard to safely access pollQuestion properties
  if (typeof pollQuestion === "object" && pollQuestion !== null && !Array.isArray(pollQuestion)) {
    const questionData = pollQuestion as Record<string, Json>;
    const elements = questionData.elements;
    
    if (Array.isArray(elements) && elements.length > 0) {
      const firstElement = elements[0];
      if (typeof firstElement === "object" && firstElement !== null && !Array.isArray(firstElement)) {
        const elementData = firstElement as Record<string, Json>;
        const title = elementData.title;
        if (typeof title === "string") {
          questionPrompt = title;
        }
      }
    }
  }

  // Get counts directly from hook - all logic is handled internally
  const { counts: choiceCounts } = usePollResponseCounts(pollId, pollQuestion);

  // Transform counts to chart data format
  const chartData = useMemo(() => {
    return Object.entries(choiceCounts).map(([name, value]) => ({
      name,
      value
    }));
  }, [choiceCounts]);

  return <PollBarChart chartData={chartData} questionPrompt={questionPrompt} />;
}
