-- Minimize DICE rawPayload to the approved dice-minimal-v1 shape.
--
-- Earlier DICE ingestion stored the full parsed event in rawPayload: the
-- description, image URLs, end date and street address, none of which
-- Afterset uses. Nothing reads rawPayload. The ingestion code was changed
-- first (1e7a1b9), so every new write already has this shape. This
-- migration rewrites the rows written before that change.
--
-- Scope: DICE rows in ShowExternalRef and ProviderMatchReview. Only the
-- rawPayload column changes. No trigger maintains updatedAt, so ids,
-- links, statuses and timestamps are untouched, as are canonical
-- Artist/Venue/Show rows, other providers' data, and all user data.
--
-- The retained values (url, name, startDate, eventStatus, locationName)
-- are copied byte-for-byte. Missing keys become JSON null, the same as
-- the writer produces.
--
-- Idempotent: a row is rewritten only when it differs from its own
-- minimized form, so an already-minimal row is never touched.

WITH minimized AS (
  SELECT id, jsonb_build_object(
    '_schema',      'dice-minimal-v1',
    'url',          "rawPayload" -> 'url',
    'name',         "rawPayload" -> 'name',
    'startDate',    "rawPayload" -> 'startDate',
    'eventStatus',  "rawPayload" -> 'eventStatus',
    'locationName', "rawPayload" -> 'locationName'
  ) AS payload
  FROM "ShowExternalRef"
  WHERE "provider" = 'dice' AND "rawPayload" IS NOT NULL
)
UPDATE "ShowExternalRef" r
SET "rawPayload" = m.payload
FROM minimized m
WHERE r."id" = m."id"
  AND r."rawPayload" IS DISTINCT FROM m.payload;

WITH minimized AS (
  SELECT id, jsonb_build_object(
    '_schema',      'dice-minimal-v1',
    'url',          "rawPayload" -> 'url',
    'name',         "rawPayload" -> 'name',
    'startDate',    "rawPayload" -> 'startDate',
    'eventStatus',  "rawPayload" -> 'eventStatus',
    'locationName', "rawPayload" -> 'locationName'
  ) AS payload
  FROM "ProviderMatchReview"
  WHERE "provider" = 'dice'
)
UPDATE "ProviderMatchReview" r
SET "rawPayload" = m.payload
FROM minimized m
WHERE r."id" = m."id"
  AND r."rawPayload" IS DISTINCT FROM m.payload;
