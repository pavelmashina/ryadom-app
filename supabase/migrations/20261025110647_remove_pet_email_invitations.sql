-- Retire the server-side email invitation feature.
-- Keep the earlier creation migration for reproducible historical migrations.
drop function if exists public.prepare_pet_email_invitation(uuid, text);
drop function if exists pet_private.prepare_pet_email_invitation(uuid, text);
drop table if exists pet_private.pet_email_invitation_attempts;
