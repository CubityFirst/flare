-- The ID token from sign-in, sent back as id_token_hint for RP-initiated logout.
ALTER TABLE sessions ADD COLUMN id_token TEXT;
