ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS delivery_pricing_mode text NOT NULL DEFAULT 'route',
  ADD COLUMN IF NOT EXISTS agreed_delivery_fee numeric(10,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'partners_delivery_pricing_mode_check'
      AND conrelid = 'public.partners'::regclass
  ) THEN
    ALTER TABLE public.partners
      ADD CONSTRAINT partners_delivery_pricing_mode_check
      CHECK (delivery_pricing_mode IN ('route', 'agreed_flat'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'partners_agreed_delivery_fee_check'
      AND conrelid = 'public.partners'::regclass
  ) THEN
    ALTER TABLE public.partners
      ADD CONSTRAINT partners_agreed_delivery_fee_check
      CHECK (agreed_delivery_fee IS NULL OR agreed_delivery_fee > 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.save_partner_delivery_pricing(
  p_partner_id uuid,
  p_pricing_mode text,
  p_agreed_delivery_fee numeric DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_igo_superadmin() THEN
    RAISE EXCEPTION 'Only an iGO superadmin can change partner delivery rates.';
  END IF;
  IF p_pricing_mode NOT IN ('route', 'agreed_flat') THEN
    RAISE EXCEPTION 'Choose a supported delivery pricing mode.';
  END IF;
  IF p_pricing_mode = 'agreed_flat'
     AND (p_agreed_delivery_fee IS NULL OR p_agreed_delivery_fee <= 0) THEN
    RAISE EXCEPTION 'An agreed delivery rate must be greater than zero.';
  END IF;

  UPDATE public.partners
  SET delivery_pricing_mode = p_pricing_mode,
      agreed_delivery_fee = CASE WHEN p_pricing_mode = 'agreed_flat' THEN p_agreed_delivery_fee ELSE NULL END
  WHERE id = p_partner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner account not found.';
  END IF;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.save_partner_delivery_pricing(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_partner_delivery_pricing(uuid, text, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_partner_delivery_pricing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pricing_mode text;
  v_agreed_fee numeric(10,2);
BEGIN
  SELECT delivery_pricing_mode, agreed_delivery_fee
    INTO v_pricing_mode, v_agreed_fee
  FROM public.partners
  WHERE id = NEW.partner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner account not found for this package.';
  END IF;

  IF v_pricing_mode = 'agreed_flat' THEN
    IF v_agreed_fee IS NULL OR v_agreed_fee <= 0 THEN
      RAISE EXCEPTION 'The agreed partner delivery rate is not configured.';
    END IF;
    NEW.delivery_fee := v_agreed_fee;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS packages_apply_partner_delivery_pricing ON public.packages;
CREATE TRIGGER packages_apply_partner_delivery_pricing
BEFORE INSERT OR UPDATE OF partner_id, delivery_fee ON public.packages
FOR EACH ROW
EXECUTE FUNCTION public.apply_partner_delivery_pricing();
