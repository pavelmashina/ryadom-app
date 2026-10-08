# Imported training diaries

Imported sessions use the existing 1–5 performance score. Every reconstructed result explains its interpretation and learning start in its comment. Original session text is kept without summarizing it. No repetition counts or durations are fabricated.

## Storage and privacy

- training_diary stores immutable source rows, date, status (conducted/skipped/linked), original text, source hash, session reference and explanatory metadata.
- The primary key (pet_id, source_key) prevents duplicate provenance.
- Only active pet members can read it. Anonymous users and non-members cannot read it; client roles cannot mutate it.
- load_shared_state includes this history. save_shared_state ignores client-supplied trainingDiary, keeping the original source intact.
- Skipped entries have no session or scores and never enter command progress.
- Linked entries reference an existing session without replacing its original results.
- No personal source material, account identifiers or one-off import scripts are included in the repository.

## Interface

Show the latest five sessions initially, with ten more on demand. Session details label reconstructed entries and expose the original text. Command details show learning notes. A collapsible source diary includes skipped days.

## Verification

The database integration suite verifies membership isolation, revocation, denied client writes and original-text preservation through normal saves. The one-off import is tested on an isolated database, checks the target revision against a private backup, writes in a single transaction, verifies unchanged native records and unrelated data, and is a no-op on repetition.
