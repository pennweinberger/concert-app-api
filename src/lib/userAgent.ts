// The outbound identity every Afterset ingestion client sends.
//
// One constant, not a copy per client: a site operator who looks up one of
// our requests should find the same name and the same working URL whichever
// source it came from, and a copy is a copy someone forgets to update.
//
// It says plainly that this is Afterset's ingestion crawler and links to the
// live product. It is never a browser string or another crawler's name.
// Afterset does not train AI models on the content it fetches.
//
// The URL has to resolve to something real. Earlier versions advertised
// afterset-pied.vercel.app/bot, a pre-domain alias whose /bot page never
// existed (404), so it told site operators nothing. afterset.fm is the
// production domain — afterset.app belongs to someone else.
export const INGESTION_USER_AGENT =
  "Afterset-IngestionBot/1.0 (+https://afterset.fm)";
