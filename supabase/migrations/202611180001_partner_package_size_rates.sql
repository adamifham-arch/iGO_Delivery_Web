-- Add customer-specific package-size delivery pricing.
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS package_size_rates jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS package_size text;

ALTER TABLE public.partners
  DROP CONSTRAINT IF EXISTS partners_delivery_pricing_mode_check;
ALTER TABLE public.partners
  ADD CONSTRAINT partners_delivery_pricing_mode_check
  CHECK (delivery_pricing_mode IN ('route', 'agreed_flat', 'package_size'));

CREATE OR REPLACE FUNCTION public.save_partner_package_size_rates(
  p_partner_id uuid,
  p_package_size_rates jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_rate numeric;
BEGIN
  IF NOT public.is_igo_superadmin() THEN
    RAISE EXCEPTION 'Only an iGO superadmin can change partner delivery rates.';
  END IF;
  IF jsonb_typeof(p_package_size_rates) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Package size rates must be an object of size and price values.';
  END IF;
  IF p_package_size_rates = '{}'::jsonb THEN
    RAISE EXCEPTION 'Set at least one package size rate.';
  END IF;

  FOR v_item IN SELECT key, value FROM jsonb_each(p_package_size_rates)
  LOOP
    IF v_item.key NOT IN ('S', 'M', 'L', 'XL') THEN
      RAISE EXCEPTION 'Unsupported package size: %.', v_item.key;
    END IF;
    IF jsonb_typeof(v_item.value) NOT IN ('number', 'string')
       OR nullif(v_item.value #>> '{}', '') IS NULL THEN
      RAISE EXCEPTION 'Every listed package size must have a price.';
    END IF;
    v_rate := (v_item.value #>> '{}')::numeric;
    IF v_rate <= 0 OR v_rate > 1000000 THEN
      RAISE EXCEPTION 'Package size prices must be greater than zero.';
    END IF;
  END LOOP;

  UPDATE public.partners
  SET delivery_pricing_mode = 'package_size',
      agreed_delivery_fee = NULL,
      package_size_rates = p_package_size_rates
  WHERE id = p_partner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner account not found.';
  END IF;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.save_partner_package_size_rates(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_partner_package_size_rates(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_partner_delivery_pricing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pricing_mode text;
  v_agreed_fee numeric(10,2);
  v_package_size_rates jsonb;
  v_size_fee numeric(10,2);
BEGIN
  SELECT delivery_pricing_mode, agreed_delivery_fee, package_size_rates
    INTO v_pricing_mode, v_agreed_fee, v_package_size_rates
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
  ELSIF v_pricing_mode = 'package_size' THEN
    IF NEW.package_size IS NULL OR NEW.package_size = '' THEN
      RAISE EXCEPTION 'Choose a package size before registering this package.';
    END IF;
    v_size_fee := nullif(v_package_size_rates ->> NEW.package_size, '')::numeric;
    IF v_size_fee IS NULL OR v_size_fee <= 0 THEN
      RAISE EXCEPTION 'No delivery rate is configured for this package size.';
    END IF;
    NEW.delivery_fee := v_size_fee;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS packages_apply_partner_delivery_pricing ON public.packages;
CREATE TRIGGER packages_apply_partner_delivery_pricing
BEFORE INSERT OR UPDATE OF partner_id, delivery_fee, package_size ON public.packages
FOR EACH ROW
EXECUTE FUNCTION public.apply_partner_delivery_pricing();
