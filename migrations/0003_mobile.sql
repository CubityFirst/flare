-- Android app support: bearer-token sessions, one-time sign-in codes and FCM devices.

-- 'web' sessions use the cookie; 'mobile' sessions are bearer tokens held by the app.
ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'web';

-- Hands a finished sign-in from the browser back to the app. Single use, valid for a few
-- minutes, and only redeemable with the PKCE verifier the app generated before signing in.
CREATE TABLE mobile_codes (
  id          TEXT PRIMARY KEY,           -- SHA-256 of the code
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  challenge   TEXT NOT NULL,              -- base64url(SHA-256(verifier))
  id_token    TEXT,
  expires_at  INTEGER NOT NULL
);

-- devices.kind is now 'webpush' or 'fcm'. For FCM devices, endpoint holds the registration
-- token and p256dh/auth are empty.
