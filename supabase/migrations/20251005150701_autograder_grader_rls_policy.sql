DROP POLICY IF EXISTS "graders rw" ON "public"."autograder";
CREATE POLICY "graders rw" ON "public"."autograder"
USING (
  "public"."authorizeforclassgrader"(class_id)
);
