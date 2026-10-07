-- Site settings (formerly django-constance). Keys are the constance key names,
-- values plain JSON (no constance {"__type__","__value__"} wrapper).
CREATE TABLE IF NOT EXISTS site_settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
