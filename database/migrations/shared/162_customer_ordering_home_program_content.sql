ALTER TABLE shared.customer_ordering_home_content
  ADD COLUMN IF NOT EXISTS program_content text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'shared.customer_ordering_home_content'::regclass
       AND conname = 'customer_ordering_home_content_program_content_length'
  ) THEN
    ALTER TABLE shared.customer_ordering_home_content
      ADD CONSTRAINT customer_ordering_home_content_program_content_length
      CHECK (char_length(program_content) <= 4000);
  END IF;
END
$$;
