-- Ensure students.id auto-generates a UUID when not supplied.
-- Required after removing crypto.randomUUID() from the sync upsert rows.
ALTER TABLE students ALTER COLUMN id SET DEFAULT gen_random_uuid();
