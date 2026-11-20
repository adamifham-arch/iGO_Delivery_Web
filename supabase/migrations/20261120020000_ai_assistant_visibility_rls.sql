-- Permit only iGO superadmins to manage the new AI assistant visibility setting.
-- The application already uses public_site_settings and public.is_igo_superadmin().
-- Do not disable row-level security or grant broader write access.

-- A superadmin can create this specific setting if it has not been saved before.
DROP POLICY IF EXISTS "igo_superadmin_insert_ai_assistant_visibility" ON public.public_site_settings;
CREATE POLICY "igo_superadmin_insert_ai_assistant_visibility"
ON public.public_site_settings
FOR INSERT
TO authenticated
WITH CHECK (
  key = 'show_ai_assistant'
  AND (SELECT public.is_igo_superadmin()) IS TRUE
);

-- And can change it later. Other accounts cannot change this key.
DROP POLICY IF EXISTS "igo_superadmin_update_ai_assistant_visibility" ON public.public_site_settings;
CREATE POLICY "igo_superadmin_update_ai_assistant_visibility"
ON public.public_site_settings
FOR UPDATE
TO authenticated
USING (
  key = 'show_ai_assistant'
  AND (SELECT public.is_igo_superadmin()) IS TRUE
)
WITH CHECK (
  key = 'show_ai_assistant'
  AND (SELECT public.is_igo_superadmin()) IS TRUE
);
