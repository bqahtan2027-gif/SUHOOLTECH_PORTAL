-- Internal meetings calendar and invitations
CREATE TABLE IF NOT EXISTS meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(200) NOT NULL,
  description varchar(4000),
  location varchar(240),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','completed','cancelled')),
  organizer_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS meetings_starts_at_idx ON meetings(starts_at);
CREATE INDEX IF NOT EXISTS meetings_organizer_idx ON meetings(organizer_id, starts_at DESC);

CREATE TABLE IF NOT EXISTS meeting_attendees (
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response varchar(20) NOT NULL DEFAULT 'invited'
    CHECK (response IN ('invited','accepted','declined')),
  responded_at timestamptz,
  PRIMARY KEY (meeting_id,user_id)
);
CREATE INDEX IF NOT EXISTS meeting_attendees_user_idx ON meeting_attendees(user_id, meeting_id);
