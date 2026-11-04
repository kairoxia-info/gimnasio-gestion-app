-- ============================================================================
-- 0097_control_exige_dos_pasos.sql
--
-- Pedido de Nalux (04/11/2026): verificación en dos pasos para su cuenta, que es la que ve todas las
-- cuentas de los clientes. La pantalla del código sola no alcanza: con la contraseña robada se podría
-- llamar directo a la API sin pasar por ella. Por eso la base exige el segundo paso.
--
-- es_admin_plataforma() es la llave de todo lo de la dueña (plataforma_resumen, telegram_preparar_vinculo,
-- telegram_conectado): con la verificación activada, solo vale una sesión que pasó el código (aal2).
-- Sin ningún factor verificado sigue valiendo la sesión común: si no, no se podría abrir el panel para
-- activarla. El bot de Telegram entra por service_role y no cambia.
--
-- Cómo sacarla si Nalux pierde el teléfono (lo puede hacer desde el SQL Editor de Supabase):
--   DELETE FROM auth.mfa_factors
--   WHERE user_id = (SELECT id FROM auth.users WHERE email = 'nadiatecera13@gmail.com');
-- ============================================================================

CREATE OR REPLACE FUNCTION public.es_admin_plataforma()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.admins_plataforma WHERE user_id = auth.uid())
    AND (
      coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      OR NOT EXISTS (
        SELECT 1 FROM auth.mfa_factors f
        WHERE f.user_id = auth.uid() AND f.status = 'verified'
      )
    )
$function$;

-- ============================================================================
-- Fin de la migración 0097.
-- ============================================================================
