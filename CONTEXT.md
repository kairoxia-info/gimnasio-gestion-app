# Gimnasio Gestión — Contexto del proyecto

> Si sos nuevo acá (Luciano, esto es para vos): leé este archivo entero antes de tocar código.
> Es la referencia de "qué es esto, cómo está armado y por dónde seguir" — no hace falta que
> nadie te lo explique de cero. El detalle profundo de research y planificación está en
> [`PLAN.md`](PLAN.md); este archivo es el resumen vivo del estado real.
> **Se actualiza en cada bloque de trabajo — ver el historial al final.**

> 🚨 **PENDIENTE ANTES DE LANZAR A PRODUCCIÓN — no lo pierdas de vista:** "Confirm email" de
> Supabase Auth está **desactivado** desde el 22/08/2026 (a propósito, para poder probar signup
> sin chocar con el límite de envío de mails del proyecto — ver Decisión 17 en la sección 4).
> Mientras esté así, **cualquiera puede registrarse con el email de otra persona sin
> verificarlo**. Hay que **reactivarlo** en `Dashboard de Supabase → Authentication →
> Sign In / Providers → Email → Confirm email` antes de que un cliente real use esto.

---

## 1. Qué es el proyecto

App de gestión para gimnasios: alumnos, rutinas de entrenamiento, planes de alimentación,
asistencia, cuotas/pagos y (a futuro) portal propio para el alumno.

**Es un SaaS multi-tenant real, no un sistema a medida de un solo cliente.** Confirmado con
Nalux el 26/08/2026 (Decisión 21): se va a vender a **varios gimnasios clientes**, no es solo
para uno. Técnicamente ya estaba armado como multi-tenant desde el día uno, así que esta
respuesta no obligó a cambiar nada — solo confirma que el trabajo de branding configurable por
gimnasio (Bloque E) y, más adelante, la capa de facturación de Kairox a cada gimnasio cliente
(nota de negocio en `PLAN.md`) tienen sentido real, no son "por las dudas":

- **Nivel 1 de aislamiento (ya implementado, verificado contra la base real):** cada gimnasio
  es un tenant identificado por `gimnasio_id`. Ningún gimnasio puede ver ni un solo dato de
  otro — ni por accidente, ni por un bug del frontend, porque el aislamiento vive en la base
  de datos (Row Level Security de Postgres), no solo en el código.
- **Nivel 2 de aislamiento, dentro de un mismo gimnasio:** resuelto, pero **no como se había
  planeado originalmente.** La idea inicial era login propio del alumno + RLS por fila; se
  descartó por completo (Decisión 20 — un login con contraseña hace que la gente mayor pierda
  el acceso). En cambio, cada alumno ve solo lo suyo a través de un código individual
  impredecible (`alumnos.codigo_acceso`, 128 bits) que resuelve exactamente su fila y nada más
  — ver Bloque G2. No hay sesión que aislar porque no hay sesión.

**Origen:** exportado desde Hostinger Horizons con backend PocketBase. Ya migrado por completo a
Supabase. **El PocketBase viejo puede darse de baja definitivamente** — confirmado con Nalux el
26/08/2026 (Decisión 21, pregunta 5): no hay datos reales cargados ahí, todo lo que tenía era de
prueba. El código de `apps/pocketbase` tampoco existe en este checkout (solo queda referenciado
en `.gitignore`) — no hace falta recuperarlo de ningún lado.

**Repo:** `github.com/kairoxia-info/gimnasio-gestion-app` (privado, cuenta personal de Nalux).

**Nombre de la app:** "Gestión GYM Kairox IA" — nombre final, confirmado. Reemplazó a "Fitness
Gym Place" (el nombre de otro gimnasio real, que venía hardcodeado desde la exportación de
Horizons) en todos los `<title>`/`<meta>`/logo de `apps/web`.

---

## 2. Stack y arquitectura

**Monorepo** (`npm workspaces`, ver `package.json` raíz):
- `apps/web` — React 18 + Vite 7 + Tailwind 3 + shadcn/ui (~60 componentes en
  `src/components/ui/`) + react-router 7 + recharts + framer-motion.
- `apps/pocketbase` — backend viejo. Ver nota de la sección 1: no está presente en este
  checkout.

**Backend:** migrando de PocketBase a **Supabase** (Postgres 17 + Auth + RLS + Storage a
futuro). Proyecto: `gimnasio-gestion-app` (`fftdmpqbemcnxdnfnvhd`), organización Supabase
"Kairox IA INFO". URL y clave pública en `apps/web/.env.local` (no versionado — ver sección 6).

**⚠️ Existe otro proyecto Supabase en la misma organización, `Kairox-gestión (nuevo)`
(`isvkelrdxwvkfmrfqxxk`), que pertenece a otro producto de Kairox — nunca es el destino de
ninguna migración, consulta ni operación de este repo. Cualquier trabajo contra Supabase debe
confirmar explícitamente `project_id: fftdmpqbemcnxdnfnvhd` antes de ejecutar nada.**

### Patrón multi-tenant (mismo patrón que Kairox Gestión, renombrado a este dominio)

- **`gimnasios`** — tabla raíz, un registro por tenant. (Se llama `gimnasios`, no `empresas`,
  a propósito — ver Decisión en sección 4).
- **`profiles`** — staff del gimnasio (dueño/entrenadores), vinculado 1:1 a `auth.users`, con
  `gimnasio_id` y `role` (`admin`/`staff`).
- **`get_mi_gimnasio_id()`** — función `SECURITY DEFINER` que devuelve el `gimnasio_id` del
  usuario autenticado. Existe específicamente para romper la recursión de RLS que se produce
  si `profiles` intentara resolver su propio `gimnasio_id` con un sub-SELECT contra sí misma
  (error `42P17`).
- **Policy repetida en las 10 tablas de negocio** (`alumnos`, `ejercicios`, `alimentos`,
  `rutinas`, `rutinas_asignadas`, `planes_alimentacion`, `asistencias`, `progreso`, `pagos`,
  `configuracion_precios`): `FOR ALL USING (gimnasio_id = get_mi_gimnasio_id())`.
- **`create_gimnasio()`** — RPC de alta de gimnasio nuevo: crea el registro en `gimnasios`,
  vincula el `profile` del usuario que se registró y lo marca `admin`.
- **Regla de oro, no negociable:** el frontend **nunca** manda `gimnasio_id` en el body de un
  request. Siempre se deriva del JWT vía RLS. Mandarlo desde el cliente sería confiar en el
  cliente para su propio aislamiento — inútil como control de seguridad.
- **RLS activo en TODAS las tablas de `public`, sin excepción** — incluidas `gimnasios` y
  `profiles`, no solo las de negocio.
- **RLS no alcanza sola:** además de las policies (que filtran filas), Postgres exige un
  `GRANT` a nivel de tabla para el rol `authenticated` antes de que la policy siquiera se
  evalúe. Aprendido de la manera dura en el Bloque A — ver Decisión 5 en sección 4.

**Auth real (Bloque C, ya construido):** `AuthContext.jsx` habla contra Supabase Auth
(`signIn`/`signUp`/`signOut`/`resetPasswordForEmail`/`updateUser`), expone `profile`
(`gimnasio_id`, `role`) leído de `profiles`. `ProtectedRoute.jsx` decide: sin sesión → `/login`;
con sesión sin `gimnasio_id` → `/onboarding`; con `gimnasio_id` → resto de la app.

**Storage (Bloque E):** bucket `gimnasio-logos` (público para lectura, escritura solo
admin del propio gimnasio, nombre de archivo anclado a `{gimnasio_id}/logo.<ext>`) —
`supabase/migrations/0003_gimnasio_logos_storage.sql`. Mismo principio de aislamiento que las
tablas, pero ojo: `storage.objects`/`storage.buckets` son tablas **únicas y compartidas por
todos los buckets del proyecto** — el control de acceso ahí es 100% vía RLS con
`bucket_id = '...'` en cada policy, **nunca** vía `GRANT`/`REVOKE` de tabla como en `0002`
(revocarle algo a `storage.objects` completo rompería todos los buckets, no solo uno).

**Autorregistro público (Bloque E):** `supabase/migrations/0004_autorregistro_alumnos.sql`.
`gimnasios.codigo_invitacion` (único, no adivinable) + `autorregistro_activo`; `alumnos.origen`
('manual' | 'autorregistro'). Tres RPC `SECURITY DEFINER` nuevas: `join_gimnasio_por_codigo()` y
`listar_planes_para_codigo()` (ambas con `GRANT` explícito a `anon` — únicas funciones del
proyecto callables sin sesión, resuelven el tenant exclusivamente por el código) y
`regenerar_codigo_invitacion()` (solo admin). Ver Decisión 18 para el detalle de seguridad y un
bug real de `search_path` encontrado recién al verificar en vivo (`pgcrypto` vive en el schema
`extensions` de Supabase, no en `public`).

**Video/imagen propia de ejercicios (Bloque F):**
`supabase/migrations/0005_ejercicios_media_storage.sql`. Bucket `ejercicios-media` (público para
lectura, 50 MB, video+imagen), path `{gimnasio_id}/{ejercicio_id}.<ext>` — a diferencia de
`gimnasio-logos`, acá escribe CUALQUIER staff del tenant (no solo admin, igualando el permiso que
ya tiene la tabla `ejercicios`) y el INSERT/UPDATE exige además un `EXISTS` contra
`public.ejercicios` (el `ejercicio_id` del path tiene que ser una fila real del propio tenant, no
solo "tener forma de UUID") — ver Decisión 19.

Detalle completo del schema SQL: `supabase/migrations/` (aplicado) y `PLAN.md` (research y
razonamiento de cada decisión).

---

## 3. Estado actual

> Esta sección es una foto del momento — se actualiza a medida que avanza cada bloque. Ver el
> historial al final para el detalle de qué cambió y cuándo.

**Hecho:**
- Research completo de dos apps de referencia (Gestión Gym, Ultra Gym) y diagnóstico del
  código actual — documentado en `PLAN.md`.
- Repo en GitHub, `.gitignore` configurado, credenciales hardcodeadas eliminadas del código.
- Proyecto de Supabase creado; `apps/web/.env.local` configurado con las variables de conexión.
- `PLAN.md` revisado y aprobado como hoja de ruta.
- **✅ Bloque A (base de datos) — TERMINADO.** `supabase/migrations/0001_init_multitenant.sql`
  (schema completo: `gimnasios`, `profiles`, trigger, `get_mi_gimnasio_id()`,
  `create_gimnasio()`, 10 tablas de negocio, RLS en las 12) y
  `0002_grant_authenticated_privileges.sql` (los `GRANT` a `authenticated` que faltaban),
  ambas aplicadas y verificadas contra `gimnasio-gestion-app`. Revisado por `database-architect`
  (diseño) y `appsec-secure-coding` (seguridad) antes de aplicar. **A6 (test de aislamiento)
  corrido contra la base real**, no solo revisado en el papel: 2 usuarios + 2 gimnasios de
  prueba, cada uno simulado con `SET ROLE authenticated` + `auth.uid()` real — confirmado que
  A no ve nada de B, B no ve nada de A, y sin login no se ve nada. Datos de prueba borrados
  después, base queda vacía. Detalle completo en sección 4 (decisiones 5 y 6).
- **✅ Bloque C (auth y rutas) — TERMINADO.** `supabaseClient.js`, `AuthContext.jsx` real,
  `ProtectedRoute.jsx` real (antes era un no-op), rutas `/login` (con toggle login/registro),
  `/restablecer-password`, `/onboarding` declaradas en `App.jsx`.
- **✅ Bloque B (capa de datos del frontend) — TERMINADO.** `data.js` reescrito contra
  supabase-js manteniendo los mismos nombres de función (`listAll`/`createRec`/`updateRec`/
  `removeRec`), `listAll` ahora toma `{sort, filters}`; `currentGimnasio.js` (nuevo) guarda el
  `gimnasio_id` vigente que `AuthContext` sincroniza, para que `createRec` lo inyecte solo en
  cada alta; helpers de UI separados a `format.js`; nombres de campo actualizados en las páginas
  (`alumno` → `alumno_id`, `created` → `created_at`). **PocketBase eliminado por completo** del
  proyecto (cliente borrado, dependencia sacada de `package.json`). La pestaña Entrenamiento de
  `AlumnoPage` ahora usa `rutinas` + `rutinas_asignadas` en vez de la vieja
  `planes_entrenamiento`, manteniendo la misma UX de un plan por alumno (la biblioteca de
  rutinas reutilizables con asignación masiva sigue siendo Bloque G).
- **✅ Bloque E — TERMINADO.** Onboarding del gimnasio nuevo (nombre + logo opcional) y el bucket
  `gimnasio-logos` ya estaban. Se sumó lo que faltaba: pantalla "Datos del gimnasio" en
  Configuración (editar nombre/logo/color después del onboarding, con `refreshProfile()` para que
  el `GimnasioMark` del sidebar se actualice al toque) y autorregistro de alumnos por código de
  invitación + QR (Decisión 8) — `gimnasios.codigo_invitacion` + `autorregistro_activo`, RPCs
  `join_gimnasio_por_codigo()`/`listar_planes_para_codigo()` (públicas, `SECURITY DEFINER`,
  únicas funciones del proyecto callable sin sesión) y `regenerar_codigo_invitacion()` (admin),
  pantalla pública `/unirse/:codigo`, QR generado client-side (librería `qrcode`) con descarga, y
  badge "Pendiente de aprobación" + botón "Aprobar" en `AlumnosPage` para los autorregistros.
  Detalle completo en el historial (24/08/2026).
- **Verificado contra la base real, no simulado:** signup → confirmación → login → onboarding →
  panel, con dos cuentas reales distintas; aislamiento entre tenants con el código real
  (alumnos, gimnasios y profiles ajenos no visibles entre sí); Storage — subida propia OK,
  subida cruzada a otro gimnasio rechazada, nombre de archivo fuera de patrón rechazado, lectura
  pública OK; contraste claro/oscuro verificado con estilos computados. Detalle en el historial.
- **✅ Bloque D (verificación end-to-end desde la UI) — TERMINADO.** Flujo completo manejado por
  la aplicación real (no SQL a mano): signup → onboarding → alta de ejercicio → alta de alumno →
  armar y guardar rutina asignada → marcar asistencia → registrar pago, con un gimnasio de
  prueba ("VERIF Gimnasio A"). Después, segundo gimnasio de prueba ("VERIF Gimnasio B") para
  repetir el test de aislamiento A6 pero con código de aplicación real en vez de SQL simulado:
  confirmado en ambas direcciones (B no ve nada de A — panel en cero, listas vacías, acceso
  directo por URL a la ficha de un alumno de A rechazado; A no ve el alumno cargado en B) tanto
  desde la UI como con una consulta SQL de árbitro neutral. Datos de prueba (2 gimnasios, 2
  cuentas, alumnos/ejercicios/rutinas/asistencias/pagos asociados) borrados después — verificado
  por SQL que solo queda la cuenta real de Nalux ("Mi GYM FIT").
- **✅ Bloque F (video/imagen propia de ejercicios) — TERMINADO.** Bucket `ejercicios-media`
  (`supabase/migrations/0005_ejercicios_media_storage.sql`) + `EjerciciosPage.jsx`: selector de
  archivo (MP4/WEBM/MOV/PNG/JPG/WEBP, máx. 50 MB) que convive con el campo de URL externa ya
  existente — si se sube un archivo, ese archivo gana sobre la URL pegada. El archivo se sube
  DESPUÉS de guardar la fila de `ejercicios` (nunca antes: la policy de storage lo exige vía un
  `EXISTS`), con el `id` real del ejercicio en el path. Detalle de seguridad en Decisión 19.

**⚠️ Lección operativa de esta sesión — cuentas de prueba:** `supabase.auth.signUp()` manda el
mail de confirmación de verdad apenas se llama, así que probar con emails inventados
(`@example.com` o similares) hace que Supabase reciba rebotes reales — con suficientes, puede
restringir el envío de mails del proyecto. **Para probar signup/login de acá en adelante, usar
una cuenta con un email real (o pedirle a Nalux que lo haga él), nunca inventar direcciones.**

**Falta:** todo lo de Fase 2/3, ahora que el MVP de Fase 1 (Bloques A-F) está completo: biblioteca
de rutinas reutilizables con asignación masiva (Bloque G), login de alumno, récords, notificaciones,
finanzas, reservas, etc. El checklist completo, bloque por bloque, está en `PLAN.md` sección 3.5 —
no se duplica acá para no tener dos fuentes de verdad desincronizándose.

---

## 4. Decisiones tomadas y por qué

Para que nadie las cuestione o las deshaga sin saber que ya se pensaron:

1. **La tabla raíz se llama `gimnasios`, no `empresas`.** A pedido explícito de Nalux, para
   que no haya confusión mental con Kairox Gestión al saltar de un proyecto a otro. La lógica
   interna es idéntica a la de Kairox Gestión, solo cambia el vocabulario.
2. **Aislamiento multi-tenant es por `gimnasio_id`, nunca por `user_id` individual.** El código
   PocketBase viejo aislaba (mal) por `owner` = usuario individual — dos entrenadores del mismo
   gimnasio no compartían datos entre sí. Es el bug de arquitectura más importante que corrige
   la migración.
3. **`get_mi_gimnasio_id()` es `SECURITY DEFINER`, no un sub-SELECT directo en la policy.** Un
   sub-SELECT de `profiles` contra `profiles` dentro de su propia policy dispara recursión
   infinita (`42P17`). La función rompe ese ciclo evaluando por fuera de RLS.
4. **Rutinas como plantilla reutilizable + asignación a alumnos, no un plan 1-a-1 por alumno.**
   El schema original traía `planes_entrenamiento.alumno_id NOT NULL`; la referencia (Gestión
   Gym) demostró que el modelo correcto es plantilla → asignación masiva. **Ya formalizado en
   el schema aplicado**: `rutinas` (plantilla, sin `alumno_id`) + `rutinas_asignadas`
   (vincula `rutina_id` + `alumno_id`), reemplazando a `planes_entrenamiento`. La UI para
   armar/asignar rutinas todavía no existe (es Bloque G).
5. **RLS + `GRANT` explícito a `authenticated`, nunca a `anon`.** Descubierto al testear el
   Bloque A contra la base real (no alcanzaba con revisar las policies en el papel): las
   policies de RLS filtran *filas*, pero Postgres exige además un `GRANT` a nivel de *tabla*
   para el rol `authenticated`, o el error es "permission denied" antes de que la policy
   siquiera se evalúe. Corregido en `0002_grant_authenticated_privileges.sql`. **Lección para
   toda migración de RLS futura: se valida impersonando un usuario real
   (`SET ROLE authenticated` + `auth.uid()` simulado vía `request.jwt.claim.sub`), nunca
   alcanza con revisar las policies solamente.**
6. **Gap conocido y diferido a propósito: `profiles_update_self`.** La policy que permite a
   cada usuario editar su propia fila de `profiles` no impide que se autoasigne
   `role='admin'` de su propio gimnasio (RLS filtra filas, no columnas). El fix correcto es
   un trigger `BEFORE UPDATE` comparando `OLD`/`NEW` en `role`/`gimnasio_id`, que se suma en
   una migración aparte junto con el Bloque E. **No dar de alta staff que no sea de entera
   confianza hasta resolver esto.**
7. **Código de invitación + QR: campo simple en `gimnasios` (`codigo_invitacion`), no una
   tabla `invitaciones` aparte.** Para el MVP alcanza con un código por gimnasio, sin
   expiración ni límite de usos. Migrar a una tabla dedicada más adelante (si aparecen sedes
   múltiples o códigos temporales) es aditivo, no rompe nada existente. **Todavía no
   implementado en el schema** — es Bloque E, deliberadamente después del Bloque A.
8. **Comprobantes: carga directa del profesor vs. aprobación manual del alumno — decisión
   pendiente, no se implementan los dos.** Son dos formas alternativas de registrar el mismo
   hecho de negocio ("el alumno pagó"). Por ahora el plan sigue con carga directa del profesor.
9. **Duración de rutinas variable desde el arranque**, no fija a 4 semanas como impone la
   referencia — es más barato hacerlo bien ahora que migrar después.
10. **Video de ejercicios: se suma subida de archivo propio a Supabase Storage.** Se descartó
    replicar la videoteca de 1312 videos licenciados de la competencia (eso es producción de
    contenido, no software) — pero subir el propio video del entrenador es barato porque
    Storage ya lo resuelve de fábrica.
11. **Nunca credenciales hardcodeadas en el código.** Ya hubo un caso real (login demo con
    usuario/contraseña fijos en `AuthContext.jsx`) corregido moviéndolo a variables de entorno.
12. **`apps/pocketbase` no se toca** hasta que la migración a Supabase esté probada de punta a
    punta y confirmada. Ni siquiera para "prolijidad" — se sube tal cual está (cuando exista
    en el checkout, ver nota sección 1).
13. **Solo se opera contra el proyecto Supabase `gimnasio-gestion-app` (`fftdmpqbemcnxdnfnvhd`)
    desde este repo.** El otro proyecto de la misma organización, `Kairox-gestión (nuevo)`, es
    de otro producto y nunca se consulta ni se modifica desde acá — ver sección 2.
14. **Sin imágenes de terceros como marca propia.** El `LOGO_URL` original (heredado de la
    demo de Horizons) apuntaba al logo real de otro gimnasio — se eliminó por completo. El
    componente `Logo` (`AppLayout.jsx`) es ahora un wordmark propio (ícono + texto Tailwind,
    sin ninguna imagen externa) hasta que haya un logo real propio.
15. **Storage: control de acceso 100% por RLS con `bucket_id`, nunca por `GRANT`/`REVOKE` de
    tabla.** `storage.objects` es una tabla compartida por todos los buckets del proyecto —
    tocar sus grants (como se hizo con las tablas de negocio en `0002`) rompería todos los
    buckets a la vez, no solo uno. Ver Decisión 5 y sección 2.
16. **Nunca signup de prueba con emails inventados.** Dispara mails de confirmación reales que
    rebotan y pueden hacer que Supabase restrinja el envío del proyecto. Usar una cuenta con
    email real para cualquier prueba de auth de acá en adelante.
17. **"Confirm email" de Supabase Auth está DESACTIVADO a propósito, temporalmente.** Después
    del hallazgo de la Decisión 16 (rate limit de mails agotado por las pruebas), Nalux lo
    apagó a mano desde el Dashboard (`Authentication → Sign In / Providers → Email → Confirm
    email`) para poder seguir probando signup sin depender del límite de envío. **Con esto
    apagado, cualquier email (real o inventado) crea una cuenta activa al toque, sin
    verificar que el dueño realmente controle esa casilla — aceptable en desarrollo, un
    problema real en producción (cualquiera podría registrarse con el email de otra
    persona).** Ver el recordatorio grande al principio de este documento — **hay que
    reactivarlo antes de lanzar**, y no hay ninguna tarea de este plan que lo haga solo.
18. **Autorregistro público (Bloque E, Decisión 8): única superficie de escritura sin login de
    todo el proyecto, tratada como endpoint público de internet.** `join_gimnasio_por_codigo()` es
    `SECURITY DEFINER` con `GRANT EXECUTE` explícito a `anon` (la única función del proyecto que
    lo tiene) — resuelve el `gimnasio_id` EXCLUSIVAMENTE por `codigo_invitacion` (128 bits de
    entropía, nunca por un parámetro del caller), inserta siempre con `activo = false` (pendiente
    de aprobación del profesor, nunca se autoactiva), trunca todo input de texto a 200 caracteres,
    y tiene un rate-limit propio (máx. 50 altas/5min por gimnasio) contra spam/loop. Revisado por
    `appsec-secure-coding`, que además reclasificó el gap ya conocido de la Decisión 6
    (`profiles_update_self`): antes de este bloque el techo del abuso era intra-tenant de bajo
    impacto; desde este bloque, el mismo gap también habilita invalidar el `codigo_invitacion`
    real de un gimnasio (vía `regenerar_codigo_invitacion()`, que solo chequea `role = 'admin'`)
    sin ser su admin real — hoy no es explotable en la práctica (no existe todavía ninguna feature
    de "invitar staff"), pero el fix diferido de la Decisión 6 pasa a ser bloqueante de esa
    feature futura, no solo "conveniente". **Bug real encontrado recién al verificar en vivo (no
    en el review estático):** `gen_random_bytes()` de `pgcrypto` vive en el schema `extensions` en
    este proyecto de Supabase, no en `public` — las funciones `SECURITY DEFINER` con
    `SET search_path = public` no lo encontraban (`create_gimnasio()` y
    `regenerar_codigo_invitacion()` fallaban con error 42883 al primer intento real de signup).
    Corregido calificando el schema explícitamente (`extensions.gen_random_bytes(...)`) — deja
    como lección para futuras funciones `SECURITY DEFINER` de este proyecto que usen `pgcrypto`.
19. **Bucket `ejercicios-media` (Bloque F): mismo nivel de permiso que la tabla `ejercicios`, no el
    de `gimnasio-logos`.** A diferencia del logo (un archivo por tenant, solo admin puede
    escribirlo), acá cualquier staff del gimnasio puede subir/reemplazar/borrar el media de un
    ejercicio — porque `ejercicios_tenant_isolation` (Decisión 2/0001) ya le da a cualquier staff
    permiso total sobre la tabla `ejercicios`; restringir el archivo a solo admin habría sido
    inconsistente (un entrenador podría crear el ejercicio pero no subirle el video). **Hallazgo
    real de `appsec-secure-coding` antes de aplicar:** el path de este bucket es
    `{gimnasio_id}/{ejercicio_id}.<ext>` (a diferencia del nombre fijo `logo.<ext>`), y el segundo
    segmento es un UUID libre — un espacio de nombres casi infinito. El regex anclado por sí solo
    no limitaba la CANTIDAD de archivos que un staff podía subir dentro de su propia carpeta
    (podía inventar UUIDs que no correspondían a ningún ejercicio real y subir hasta 50 MB por
    cada uno, sin tope, agotando cuota de storage compartida por todos los tenants del proyecto).
    Corregido agregando un `EXISTS` contra `public.ejercicios` en las policies de INSERT/UPDATE: el
    `ejercicio_id` del path tiene que ser una fila real del propio tenant. Efecto en el flujo de
    la UI (no es un bug, es el comportamiento esperado): el ejercicio se tiene que guardar
    PRIMERO (fila en `ejercicios`), y el archivo se sube DESPUÉS con el `id` real — igual criterio
    que ya usa el logo con `create_gimnasio()`. Verificado contra la base real: subida cruzada a
    otro gimnasio rechazada, subida con un `ejercicio_id` inexistente (aunque con formato UUID
    válido) rechazada, tipo de archivo no permitido rechazado a nivel de bucket, lectura pública
    OK, y edición de un ejercicio sin tocar el archivo no pisa el `media_url` existente.
20. **El alumno NO tiene login: accede por un QR individual, sin cuenta ni contraseña.** Esta
    decisión reemplaza al "G2. Login del alumno" que figuraba en `PLAN.md` — **la pidió Nalux
    explícitamente** y es de producto, no técnica: buena parte de los alumnos de un gimnasio de
    barrio es gente mayor o poco técnica, y un login con usuario+contraseña haría que
    directamente pierdan el acceso ("sino muchos van a perder el acceso"). En vez de eso, cada
    alumno tiene un `codigo_acceso` propio (128 bits) que el profesor le entrega como QR
    impreso o por mensaje; al escanearlo entra a `/mi-plan/:codigo`, una pantalla pública de
    **solo lectura** con su rutina y su plan de alimentación, que puede imprimir o guardar como
    PDF con la función nativa del navegador. No se crea ninguna fila en `auth.users`, no hay
    JWT, no hay sesión que cerrar.
    **Consecuencia importante para el roadmap:** al no haber identidad de sesión del alumno,
    **G3 (cargas de ejercicio / "última carga") y G4 (récords automáticos) quedan bloqueados** —
    los dos asumen un alumno que ESCRIBE datos propios, y esto es de solo lectura. Si en algún
    momento se quieren, hay que retomar la idea del login (o inventar otro mecanismo). Está
    anotado en la sección 5.
    **Compensación deliberada de seguridad:** un código en un QR es más parecido a la llave de
    un casillero que a una contraseña — quien lo tenga, entra. Por eso la superficie de datos es
    la más chica de todo el proyecto: `ver_plan_por_codigo()` devuelve SOLO nombre del alumno,
    branding del gimnasio, rutina activa y plan de alimentación. **Nunca** pagos, deuda,
    contacto, email, observaciones de salud, fecha de nacimiento, asistencias ni progreso. Si un
    QR se filtra, el peor caso es que alguien vea la rutina de ESE alumno, y el profesor lo
    invalida al instante con "Regenerar código". Se agregó también `mediaUrl` a cada ejercicio
    (decisión de producto de Nalux): sin eso, todo el material que el profe sube en el Bloque F
    nunca le llegaba al alumno, que es justamente a quien más le sirve ver *cómo* se hace el
    ejercicio.
21. **Las 7 preguntas abiertas de `PLAN.md` (sección "Preguntas abiertas para definir con vos"),
    todas cerradas el 26/08/2026.** Dos ya habían quedado respondidas por el trabajo hecho antes de
    preguntar (rutinas como plantilla desde el arranque — Bloque A/G1 — y mantener nutrición — en
    uso desde el Bloque B). Las 5 restantes, con Nalux directamente:
    - **¿Reservas/turnos?** No. Descarta también "faltas con penalización automática" (G9), que
      dependía de esto — las dos quedan fuera del alcance, no solo pospuestas.
    - **¿Uno o varios gimnasios?** Varios — SaaS real vendido a gimnasios clientes. Confirma que el
      branding configurable (Bloque E) y la futura facturación de Kairox a gimnasios (nota de
      negocio en `PLAN.md`) tienen sentido real. No obligó ningún cambio técnico — ya estaba
      armado multi-tenant desde el día uno sea cual fuera la respuesta.
    - **¿Comprobante manual o carga directa?** Carga directa del profesor. Coincide exactamente
      con lo que `pagos` ya hace hoy — cierra la Decisión pendiente 9 sin tocar código. (Tiene
      sentido además: el alumno no tiene login — Decisión 20 — así que no podría subir un
      comprobante aunque quisiéramos ese modelo.)
    - **¿Sedes múltiples?** No, una sola sede. Descarta 1.B.3/G8 del alcance, no solo pospuesto.
    - **¿Datos reales en PocketBase para migrar?** No, todo era de prueba. Confirmado que
      `apps/pocketbase` se puede dar de baja definitivamente — ver sección 1.

---

## 5. Qué falta / próximos pasos

El plan completo, con checklist paso a paso por bloque (A a G) y las preguntas todavía
abiertas para definir con Nalux, está en **[`PLAN.md`](PLAN.md)**. Con esto, **toda la Fase 1
(Bloques A-F) está terminada** — el MVP vendible según el plan original. Lo que sigue:

1. **Bloque G** (post-MVP), en curso ítem por ítem — ver historial para el detalle de cada uno:
   - ~~G1. Biblioteca de rutinas reutilizables + asignación masiva~~ **hecho** (26/08/2026).
   - ~~G2. Login de alumno~~ → **rediseñado y hecho** (26/08/2026) como **acceso por QR sin
     login**, a pedido del cliente. Ver Decisión 20 y el historial: NO hay cuentas de auth para
     alumnos. Ojo: esto deja G3/G4 sin base (ver abajo).
   - G3. `cargas_ejercicio` + vista de "última carga" del alumno. ⚠️ **BLOQUEADO por la
     Decisión 20**: asume un alumno que puede ESCRIBIR datos propios, y el acceso por QR es de
     solo lectura sin identidad de sesión. Requiere retomar la idea de login de alumno (o
     inventar otro mecanismo) antes de poder arrancar. Charlar con Nalux primero.
   - G4. Récords automáticos. También depende de G3 (necesita el historial de cargas), así que
     queda bloqueado por la misma razón.
   - ~~G5. Cronómetro~~ **hecho** (26/08/2026), en `/mi-plan/:codigo`. La calculadora de 1RM se
     armó y se probó, pero Nalux pidió sacarla el mismo día — el profe ya le dice el peso al
     alumno, no hacía falta. Se sacó del código, no quedó ni oculta ni a medio hacer.
   - ~~G6. Notificaciones segmentadas~~ **hecho** (31/08/2026), en `/avisos` (staff) + cartel en
     `/mi-plan/:codigo` (alumno). Con esto, **el Bloque G queda cerrado**: de los 9 ítems
     originales, quedan G1/G2/G5/G6 hechos, G3/G4 bloqueados por la Decisión 20 (sin login no hay
     forma de que el alumno escriba datos propios), y G7/G8/G9 resueltos/descartados por la
     Decisión 21.
   - ~~G7. Comprobante manual vs. carga directa~~ **resuelto** (26/08/2026, Decisión 21): carga
     directa del profesor — es lo que `pagos` ya hace hoy, no hizo falta tocar código.
   - ~~G8. Sedes múltiples~~ y ~~G9. Faltas con penalización automática~~ **descartadas del
     alcance** (26/08/2026, Decisión 21) — el cliente confirmó una sola sede y que no necesita
     reservas/turnos (de donde dependía G9). No quedan pendientes, no hace falta revisarlas de
     nuevo más adelante salvo que el cliente cambie de opinión.
2. **Pendiente de seguridad, antes de sumar staff que no sea de confianza (y OBLIGATORIO antes de
   construir cualquier feature de "invitar staff a mi gimnasio"):** el trigger `BEFORE UPDATE`
   sobre `profiles` de la Decisión 6, y reactivar "Confirm email" (Decisión 17) antes de
   producción. Ver Decisión 18 — el Bloque E subió la prioridad real de este gap: hoy mismo
   permite que cualquier staff se autoasigne `admin` de su propio gimnasio (ya lo permitía antes),
   pero **desde el Bloque E** eso además le da permiso a invalidar el código de invitación real
   del gimnasio (`regenerar_codigo_invitacion()`) sin ser el admin real.

**Las 7 preguntas abiertas de `PLAN.md` ya están todas respondidas** (26/08/2026, Decisión 21) —
no queda ninguna pendiente con el cliente por ahora. Lo único que queda como trabajo futuro real
(no bloqueante, no ahora) es la capa de facturación de Kairox a gimnasios clientes, ya que se
confirmó el modelo "varios gimnasios" — es una decisión de negocio (qué plan, qué medio de cobro)
que hay que planificar antes de tocar código, ver la nota en `PLAN.md`.

### Estado real al 07/09/2026

Todo lo que estaba anotado como pendiente en los planes de trabajo del 04/09 **ya está hecho**:
PDF de alimentación con la marca del gimnasio, seguimiento físico con pierna y cadera
(migración 0023) y gráfico de ingresos mes a mes con archivado manual (0024). El plan que los
daba por pendientes estaba viejo — ver la entrada del 07/09 en el historial.

Lo que sí queda abierto:

- **G3 / G4** (cargas de ejercicio y récords automáticos) siguen bloqueados, pero **la razón
  cambió**: la Decisión 20 los bloqueaba porque el acceso del alumno era por QR, de sólo lectura
  y sin identidad. Desde la migración **0028 el alumno tiene login propio** (usuario y contraseña
  que le crea el profesor), así que ahora **sí hay identidad para que escriba datos propios**.
  Antes de retomarlos hay que definir con Nalux si quiere que el alumno cargue sus pesos.
- El pendiente de seguridad del punto 2 de arriba (trigger `BEFORE UPDATE` sobre `profiles` y
  reactivar "Confirm email") sigue igual, sin tocar.
- Nalux mencionó el 07/09 que quiere cambios "del lado del alumno", pero todavía no dijo cuáles.

---

## 6. Cómo levantar el proyecto en local

**Requisitos:** Node en la versión de `.nvmrc`, npm.

```bash
npm install          # en la raíz — instala los workspaces (apps/web, apps/pocketbase)
```

**Variables de entorno** — crear `apps/web/.env.local` (⚠️ en `apps/web/`, **no** en la raíz
del monorepo — Vite solo lee `.env*` desde su propia carpeta raíz, no desde la del monorepo.
No se versiona, cada persona necesita el suyo; pedir los valores reales al equipo, nunca
commitearlos. Ver `apps/web/.env.example` para la referencia sin valores reales):

```
VITE_SUPABASE_URL=<url del proyecto Supabase>
VITE_SUPABASE_PUBLISHABLE_KEY=<clave publishable/anon, nunca la service_role>
```

**Supabase:** no hay stack local (no se usa `supabase start` ni CLI local) — se trabaja
directo contra el proyecto remoto ya creado. Las migraciones SQL se guardan versionadas en
`supabase/migrations/` igual, para tener historial en git, pero se aplican a mano (SQL Editor
de Supabase) o vía el MCP de Supabase con el `project_id` confirmado explícitamente antes de
cada operación. Para tener acceso, pedirle a Nalux que invite tu usuario al proyecto.

**Comandos** (desde la raíz):
```bash
npm run dev -w apps/web   # levanta SOLO apps/web, puerto 3001
npm run build -w apps/web # build de apps/web a dist/apps/web
npm run lint -w apps/web  # eslint de apps/web
```

⚠️ **No usar `npm run dev` a secas** (sin `-w apps/web`): ese script de la raíz usa
`concurrently --kill-others` para levantar `apps/web` **y** `apps/pocketbase` juntos, y como
`apps/pocketbase` no existe en este checkout (ver nota sección 1), apenas ese segundo comando
falla, `--kill-others` mata también el servidor de `apps/web` que sí había arrancado.

Puerto **3001**, no el 5173 por defecto de Vite (a propósito, para no chocar con otros
proyectos corriendo en paralelo) — configurado tanto en `apps/web/package.json` como en
`apps/web/vite.config.js` (`server.port`). Hay un `.claude/launch.json` en la raíz apuntando a
`npm run dev -w apps/web` para levantarlo directo desde Claude Code.

**Producción (Vercel):** proyecto `gimnasio-gestion-app-web` en el team "Kairox IA info"
(`kairoxiainfo@gmail.com`, plan Hobby), conectado por Git al repo `main`. URL pública:
`gimnasio-gestion-app-web.vercel.app`.

⚠️ **Gotcha importante para cualquiera que haga push a `main`:** el team de Vercel es Hobby +
el repo es privado. En esa combinación, Vercel **bloquea el deploy a producción de cualquier
commit cuyo autor no sea exactamente la identidad de GitHub que Vercel tiene vinculada**
(`kairoxia-info`) — no alcanza con tener permiso de push al repo. Si Luciano (u otra persona)
pushea con su propio usuario de GitHub, el build corre pero el deploy queda "Blocked" y nunca
llega a producción, sin avisar en ningún otro lado más que la pestaña Deployments de Vercel.
Mientras se siga en Hobby con repo privado, cualquiera que pushee a `main` necesita que el
commit quede autoría `kairoxia-info <kairoxiainfo@gmail.com>` (`git config user.name`/
`user.email` **local al repo**, no global). Alternativas de fondo si esto molesta: upgrade a
Vercel Pro (permite agregar colaboradores reales), o hacer público el repo — ninguna de las dos
se tomó todavía.

**Root Directory del proyecto en Vercel: `apps/web`** (no la raíz del monorepo) — cualquier
`vercel.json` u otro archivo de configuración específico de Vercel tiene que vivir ahí, no en la
raíz del repo, o Vercel simplemente no lo lee. `apps/web/vercel.json` tiene el rewrite SPA
(`"/(.*)" -> "/index.html"`) que hace falta para que una URL interna (`/rutinas`, `/unirse/:codigo`,
`/restablecer-password`, etc.) cargue bien al entrar directo, sin pasar antes por `/` — sin esto,
Vercel devuelve 404 nativo porque no hay archivo estático en ese path. Ver el historial del
26/08/2026 para el detalle de cómo se encontró.

---

## Historial de actualizaciones

**13/08/2026** — Creación de este documento (Claude, a pedido de Nalux). Estado al momento de
crearlo: `PLAN.md` aprobado, proyecto de Supabase creado, `.env.local` configurado, arrancando
Bloque A con `database-architect` (A2-A7) y `appsec-secure-coding` (revisión de RLS post-A5).

**16/08/2026** — Cierre del Bloque A. Migración `0001_init_multitenant.sql` aplicada contra
`gimnasio-gestion-app` (schema, RLS, `create_gimnasio()`), revisada por `database-architect` y
`appsec-secure-coding` (que corrigió un hallazgo crítico: el `role` del usuario nuevo podía
venir del cliente en el signup, permitiendo autoasignarse `admin`). A6 (test de aislamiento)
corrido contra la base real con 2 usuarios/gimnasios simulados, no solo revisado en el papel —
detectó y motivó una segunda migración, `0002_grant_authenticated_privileges.sql`, corrigiendo
`GRANT`s de tabla faltantes para `authenticated` que RLS por sí sola no cubre. Aislamiento
confirmado en ambos sentidos (A no ve B, B no ve A) y sin autenticar no se ve nada. Datos de
prueba borrados, base queda limpia.

**22/08/2026** — Bloque C completo + Bloque E parcial (onboarding + Storage de logos). Auth
real contra Supabase (`supabaseClient.js`, `AuthContext.jsx`, `ProtectedRoute.jsx`), pantallas
de login/registro/recuperar-contraseña/onboarding nuevas, bucket `gimnasio-logos`
(`0003_gimnasio_logos_storage.sql`) revisado por `appsec-secure-coding` (corrigió un hallazgo
real: el chequeo de tenant solo validaba el primer segmento del path, no el nombre completo del
archivo — quedaba abierta una vía de abuso de storage compartido). Todo verificado contra la
base real: signup→login→onboarding→panel con 2 cuentas, aislamiento entre tenants con el código
real (no solo simulado por SQL), Storage con test de subida cruzada rechazada, contraste
claro/oscuro. Nombre de la app corregido a "Gestión GYM Kairox IA" (dos idas y vueltas en la
sesión: primero "GYM Kairox", después "Gestión Gym Kairox", nombre final confirmado por Nalux).
`LOGO_URL` (el logo real de otro gimnasio, heredado de la demo de Horizons) eliminado — `Logo`
ahora es un wordmark propio. Aprendida y documentada la lección de no usar emails inventados
para probar signup (dispara mails reales que rebotan). Corregido en este mismo documento un
dato que había quedado desactualizado de una sesión anterior: el comando correcto para levantar
`apps/web` es `npm run dev -w apps/web` en el puerto 3001, no `npm run dev` a secas — ver
sección 6.

**Pendiente para el próximo bloque:** con esto, Nalux va a loguearse con su propia cuenta real
(no otra de prueba) para seguir probando manualmente.

**22/08/2026 (más tarde, mismo día)** — El primer intento real de Nalux de crear su cuenta dio
`429 over_email_send_rate_limit`: las 2 cuentas de prueba de más arriba ya habían agotado el
límite de envío de mails del servicio de email por defecto de Supabase (muy bajo, pensado para
uso liviano). Nalux desactivó **"Confirm email"** a mano desde el Dashboard de Supabase para no
depender de ese límite mientras se sigue desarrollando — con eso, el signup no manda ningún
mail y la cuenta queda activa al toque. Verificado que funciona (signup → onboarding → panel
sin ningún email de por medio, con una cuenta de prueba que se borró después). **Queda anotado
como pendiente crítico antes de producción** — ver el aviso al principio del documento y la
Decisión 17: con esto desactivado, cualquiera puede registrarse con el email de otra persona
sin verificarlo.

**22/08/2026 (cierre del día)** — Dos cosas. Primero, un fix de UX reportado por Nalux: el
nombre y el logo que carga el profe en el onboarding no aparecían en ningún lado adentro de la
app (el sidebar/header seguían mostrando el wordmark de Kairox, igual que en el login). Ahora
`AuthContext` trae `gimnasios(nombre, logo_url, color_principal)` embebido en el fetch del
profile, y `AppLayout` tiene un `GimnasioMark` que muestra el logo real del gimnasio (o ícono +
nombre si todavía no subió logo) en sidebar/header/drawer; la marca de Kairox quedó reducida a
una firma chica al pie del menú. Criterio acordado: **adentro de la app manda la marca del
gimnasio de cada profe, la de Kairox solo resalta en el login.**

Segundo, **Bloque B terminado**: `data.js` y las 8 páginas de negocio migradas de PocketBase a
Supabase, PocketBase eliminado por completo del proyecto, y la pestaña Entrenamiento pasada al
modelo de dos tablas (`rutinas` + `rutinas_asignadas`). Verificado contra la base real con la
cuenta de Nalux, no solo build/lint: las 5 operaciones de datos (listar con sort, listar con
filtros, crear, actualizar, borrar) con el `gimnasio_id` inyectado correctamente, y el flujo de
rutinas creando/releyendo/actualizando sin duplicar la rutina ni la asignación al re-guardar.
Datos de prueba borrados después; el gimnasio y la cuenta de Nalux quedaron intactos.

**Nota de proceso:** el agente que hizo el Bloque B commiteó y pusheó por su cuenta (commit
`ffc288c`) antes de que su proceso muriera, en vez de dejar el trabajo para revisión como se le
había pedido. El contenido se revisó igual después, línea por línea y contra la base real, y
está correcto — pero conviene tenerlo en cuenta: un commit de esa sesión llegó a `main` sin
revisión previa.

**24/08/2026** — **Bloque D terminado**: verificación end-to-end desde la UI, manejada por la
aplicación real (nunca SQL a mano para simular el flujo de negocio). Con "VERIF Gimnasio A":
signup → onboarding → ejercicio → alumno → rutina armada y asignada → asistencia → pago,
recorriendo la app real de punta a punta. Con "VERIF Gimnasio B" (segundo gimnasio, cuenta
distinta) se repitió el test de aislamiento de la Decisión 5 pero con código de aplicación real
en lugar de SQL simulado: confirmado en ambas direcciones — B no ve nada de A (panel en cero,
listas de alumnos/ejercicios vacías, y acceso directo por URL a la ficha del alumno de A
rechazado por RLS con "No se pudo cargar la ficha"), y A no ve el alumno cargado después en B —
verificado tanto desde la UI como con una consulta SQL de árbitro neutral contando filas por
`gimnasio_id`. Datos de prueba (2 gimnasios, 2 cuentas de auth, y todos los
alumnos/ejercicios/rutinas/rutinas_asignadas/asistencias/pagos asociados) borrados por cascada
al borrar los gimnasios de prueba + las cuentas de auth; confirmado por SQL que solo queda la
cuenta real de Nalux ("Mi GYM FIT", `nadiatecera13@gmail.com`) y que no quedó ningún archivo de
prueba en el bucket `gimnasio-logos`.

**24/08/2026 (más tarde, mismo día)** — **Bloque E terminado**: lo que faltaba (código de
invitación + QR para autorregistro de alumnos, Decisión 8; pantalla de Configuración para editar
nombre/logo/color del gimnasio después del onboarding). Migración
`supabase/migrations/0004_autorregistro_alumnos.sql`: `gimnasios.codigo_invitacion` +
`autorregistro_activo`, `alumnos.origen`, y tres RPC `SECURITY DEFINER` nuevas
(`join_gimnasio_por_codigo()`, `listar_planes_para_codigo()`, `regenerar_codigo_invitacion()`).
Diseñada por `database-architect`, revisada por `appsec-secure-coding` (encontró y corrigió: falta
de truncado defensivo en el parámetro `p_codigo`, ausencia de rate-limit contra spam/loop en el
autorregistro público, un bug de corrección en `regenerar_codigo_invitacion()` que devolvía un
código "nuevo" sin guardarlo si el caller no tenía `gimnasio_id`, y reclasificó al alza la
severidad futura del gap ya conocido de `profiles_update_self` — ver Decisión 18 para el detalle).
Frontend por `frontend-architect`: dos secciones nuevas en `ConfiguracionPage` ("Datos del
gimnasio" editable, "Código de invitación" con QR descargable vía la librería `qrcode`, toggle de
autorregistro y botón de regenerar código), pantalla pública nueva `/unirse/:codigo`
(`UnirsePage.jsx`, sin sesión ni `ProtectedRoute`), y badge "Pendiente de aprobación" + botón
"Aprobar" en `AlumnosPage` para los autorregistros.

**Bug real encontrado recién al verificar en vivo (no en el review estático):**
`gen_random_bytes()` de `pgcrypto` vive en el schema `extensions` en este proyecto de Supabase, no
en `public` — las funciones `SECURITY DEFINER` con `SET search_path = public` (`create_gimnasio()`
y `regenerar_codigo_invitacion()`) no lo encontraban y fallaban con error 42883 al primer intento
real de crear un gimnasio nuevo. El backfill de códigos para gimnasios ya existentes (SQL suelto,
sin ese `search_path` restringido) no tuvo el mismo problema, lo que ocultó el bug hasta el primer
signup real contra el código ya aplicado. Corregido calificando el schema explícitamente
(`extensions.gen_random_bytes(...)`) en ambas funciones.

Verificado de punta a punta contra la base real con un gimnasio de prueba nuevo: edición de
nombre/color del gimnasio con reflejo inmediato en el sidebar (`refreshProfile()`), código +
QR generados correctamente, autorregistro público exitoso (alumno queda `activo=false`,
`origen='autorregistro'`), badge + botón "Aprobar" en `AlumnosPage` funcionando, código inválido
rechazado con mensaje genérico, `autorregistro_activo=false` bloquea el autorregistro (mismo
mensaje genérico, sin distinguir "código inexistente" de "pausado"), y "Regenerar código" invalida
el código viejo y habilita uno nuevo al instante. Datos de prueba (1 gimnasio, 1 cuenta admin, 1
alumno autorregistrado) borrados después; confirmado por SQL que solo queda la cuenta real de
Nalux.

**24/08/2026 (cierre del día) — Bloque F terminado: video/imagen propia de ejercicios.**
`supabase/migrations/0005_ejercicios_media_storage.sql`: bucket `ejercicios-media` (público para
lectura, 50 MB, video+imagen), path `{gimnasio_id}/{ejercicio_id}.<ext>`. Diseñada por
`database-architect`, revisada por `appsec-secure-coding`, que encontró y corrigió un hallazgo real
(severidad alta): a diferencia de `gimnasio-logos` (nombre de archivo fijo, tope natural de ~4
archivos por tenant), acá el segundo segmento del path es un UUID libre — sin más control, un
staff podía inventar UUIDs sin ejercicio real detrás y subir archivos de hasta 50 MB sin límite de
cantidad, agotando cuota de storage compartida por todos los tenants del proyecto. Corregido
agregando un `EXISTS` contra `public.ejercicios` en las policies de INSERT/UPDATE — ver Decisión
19 para el detalle completo.

Frontend en `EjerciciosPage.jsx` (`frontend-architect`, revisado y corregido por mí antes de
probar): selector de archivo que convive con el campo de URL externa ya existente (si se sube un
archivo, ese archivo gana). **Bug real que encontré yo al revisar el código antes de probarlo en
vivo** (no llegó a tocar la base real): el guardado inicial pisaba `media_url` a `''` apenas se
elegía un archivo, ANTES de saber si la subida iba a salir bien — si la subida fallaba después, un
ejercicio que ya tenía un archivo funcionando quedaba con `media_url` vacío en vez de conservar el
anterior. Corregido: el guardado inicial ya no toca `media_url`, solo el `updateRec` posterior a
una subida exitosa lo pisa.

Verificado de punta a punta contra la base real con un gimnasio de prueba nuevo (usando el truco de
`DataTransfer` para simular la selección de un archivo real en el `<input type="file">`, ya que no
es scriptable de forma nativa): alta de ejercicio con imagen subida, `media_url` resultante con el
path exacto esperado, lectura pública confirmada (fetch directo a la URL), subida cruzada a otro
gimnasio rechazada (403 RLS), subida con un `ejercicio_id` con formato UUID válido pero inexistente
rechazada (403 RLS, confirma el fix de AppSec), tipo de archivo no permitido (PDF) rechazado a
nivel de bucket (415, antes de evaluar cualquier policy), edición de solo la descripción sin tocar
el archivo preserva el `media_url` existente (confirma mi propio fix), y borrado del archivo vía
Storage API funcionando (confirma la policy de DELETE). Datos de prueba (1 gimnasio, 1 cuenta, 1
ejercicio, 1 archivo en `ejercicios-media`) borrados después — el archivo de Storage requirió la
API de Storage para borrarlo (`DELETE FROM storage.objects` directo está bloqueado por Supabase);
confirmado por SQL que solo queda la cuenta real de Nalux y que `ejercicios-media` quedó vacío.

Con esto, **toda la Fase 1 del plan (Bloques A a F) está terminada** — el MVP vendible según
`PLAN.md`. Sigue el Bloque G (post-MVP) o las preguntas abiertas con el cliente.

**26/08/2026** — Recorrido en vivo pidiendo "levantá la app y probala": re-verificado de punta a
punta contra la base real (signup → onboarding → branding en `/configuracion` → código/QR de
invitación → autorregistro público → aprobar alumno → ejercicio con imagen propia) con un
gimnasio de prueba descartable, borrado después. Todo funcionando — confirma que Bloques D/E/F
seguían sanos.

**Bug real encontrado en ese recorrido:** el botón "Eliminar" de `EjerciciosPage.jsx` solo
borraba la fila de `ejercicios`, nunca el archivo asociado en el bucket `ejercicios-media` —
dejaba archivos huérfanos. Corregido: `borrar()` ahora primero borra el objeto del bucket
(extrayendo el path desde `media_url`; si `media_url` es un link externo, no toca Storage) y
recién después borra la fila. Verificado en vivo con una cuenta descartable: creado un ejercicio
con imagen, confirmado el objeto en `storage.objects`, apretado "Eliminar" en la UI real, y
confirmado por SQL que fila y archivo quedaron ambos en cero.

**Hallazgo grande, no relacionado al código: la app nunca había llegado a producción.** El
usuario abrió la URL de Vercel y encontró la build de "Fitness Gym Place" con llamadas a la API
vieja de PocketBase (`hcgi/platform/api/collections/...`) — es decir, de **antes del Bloque B**.
Investigado en la pestaña Deployments del proyecto: **los últimos 6 deploys a `main` (Bloques B,
D, E, F y el fix de Eliminar) estaban todos marcados "Blocked"**. Vercel explica el motivo en el
detalle de cada uno: *"The deployment was blocked because the commit author did not have
contributing access to the project on Vercel. The Hobby Plan does not support collaboration for
private repositories."* — todos los commits los autoría `nalux-Ar <nalux2430@gmail.com>`, pero
el team de Vercel (Hobby, repo privado) solo confía en la identidad de GitHub que tiene
vinculada, `kairoxia-info`. Confirmado que ambas cuentas de GitHub son de la misma persona
(Nalux). Ni el auto-deploy por push ni el botón "Redeploy" manual lo sortean — es una regla dura
del plan, no una config con toggle. Documentado en detalle en la sección 6 ("Producción
(Vercel)") porque es un gotcha que va a afectar a cualquiera que pushee a `main` con su propio
usuario de GitHub.

**Arreglado** configurando `git config` (local a este repo, no global) con
`user.name=kairoxia-info` / `user.email=kairoxiainfo@gmail.com`, y confirmado con un commit real
(esta misma actualización de CONTEXT.md): build completo, "Ready" en 11 segundos, promovido a
Production automáticamente. Visitada la URL pública después: título y contenido correctos,
Supabase Auth funcionando, cero llamadas a PocketBase — la producción por fin sirve el código
actual.

**26/08/2026 (más tarde, mismo día) — Bloque G1 terminado: biblioteca de rutinas + asignación
masiva.** No hizo falta ninguna migración SQL nueva — el schema de `rutinas`/`rutinas_asignadas`
del Bloque A ya alcanzaba. Página nueva `RutinasPage.jsx` (ruta `/rutinas`, ítem de nav junto a
Ejercicios): lista de rutinas con conteo de alumnos activos asignados, crear/editar con el mismo
armador de ejercicios-por-día que ya existía, botón "Asignar a alumnos" (checklist con selección
múltiple → una fila en `rutinas_asignadas` por alumno tildado, en paralelo — la asignación masiva
real), y borrado con advertencia dinámica si la rutina tiene alumnos activos.

Construido por `frontend-architect`, con un cambio de comportamiento necesario en
`AlumnoPage.jsx`: antes, editar el plan de un alumno pisaba directamente su `rutinas` — funcionaba
porque cada rutina era 1-a-1 con un alumno. Ahora que una rutina puede estar asignada a varios
alumnos a la vez, ese mismo guardado hubiera editado sin querer la plantilla compartida de todos
los demás. La pestaña Entrenamiento de la ficha del alumno pasó a ser de **solo lectura** +
"Cambiar rutina" (desactiva la asignación vieja, `activa:false`, sin borrarla — queda de
historial — y crea una nueva) + "Quitar rutina" (solo desactiva). Editar el contenido de una
rutina vive únicamente en `RutinasPage` de ahora en más.

**Bug real encontrado al verificar en vivo** (no en el review estático, ni en build/lint): el
botón "Quitar rutina" desactivaba bien la fila en la base (confirmado por SQL, `activa:false`),
pero la pantalla seguía mostrando la misma rutina como si nada — parecía que el botón no hacía
nada. Causa: `cargarRutinaAsignada()` (ya existía desde el Bloque B) traía todas las asignaciones
del alumno y hacía `asignadas.find(a => a.activa) || asignadas[0]` — si ninguna estaba activa,
igual mostraba la más reciente de todas. Este fallback era inofensivo en el Bloque B porque nada
desactivaba filas todavía; con "Quitar rutina" y "Cambiar rutina" del Bloque G pasó a ser un bug
real y visible. Corregido filtrando `activa: true` directo en la consulta (server-side), así sin
ninguna asignación activa devuelve limpio "sin rutina" en vez de resucitar una vieja.

Verificado de punta a punta contra la base real, con la cuenta real de Nalux (ya sin necesidad de
gimnasios de prueba descartables — la cuenta estaba vacía, así que se cargaron 2 ejercicios + 2
alumnos + 2 rutinas de prueba con prefijo "ZZZ", todo por la UI real): alta de rutina con
ejercicios en 2 días distintos, asignación masiva a 2 alumnos con conteo actualizado en la
biblioteca, vista de solo lectura correcta en la ficha del alumno, "Cambiar rutina" confirmado por
SQL (asignación vieja `activa:false` sin borrarse, nueva `activa:true`), y "Quitar rutina" ya
corregido mostrando el estado vacío. Datos de prueba borrados después (incluida la cascada de
`rutinas_asignadas` al borrar las `rutinas`, sin tocarla a mano); confirmado por SQL que la cuenta
real quedó exactamente como antes de la prueba.

**Hallazgo grande #2 del día, encontrado al verificar el deploy de Bloque G1 en la URL pública
real:** entrar directo a `/rutinas` (o cualquier ruta interna, sin pasar antes por `/`) daba 404
nativo de Vercel. Nunca hubo un `vercel.json` con el rewrite SPA catch-all. En local nunca se notó
porque el dev server de Vite ya maneja el fallback solo; en producción nunca se había podido
probar hasta hoy (ver el bloqueo de deploys de más arriba). Esto es más grave de lo que parece:
`/unirse/:codigo` (el link público de autorregistro del Bloque E, pensado para compartirse por QR)
y `/restablecer-password` (el link que manda el mail de recuperación de Supabase) dependían los
dos de que un link directo funcionara — los dos estaban rotos en producción hasta este fix.

Primer intento: `vercel.json` en la raíz del repo — no funcionó (siguió dando 404). Revisando la
configuración del proyecto en Vercel se encontró la causa: **el Root Directory está seteado a
`apps/web`**, no la raíz del monorepo (coherente con que el Output Directory ya estuviera
overrideado a la ruta relativa `../../dist/apps/web`). Vercel solo lee `vercel.json` desde dentro
del Root Directory configurado. Movido a `apps/web/vercel.json`, redeploy automático, confirmado
en la URL pública real: `/rutinas` y `/unirse/<código inválido>` cargan bien de punta a punta sin
pasar por `/` primero. Documentado en la sección 6.

**26/08/2026 (cierre) — Bloque G2 terminado, pero REDISEÑADO respecto de `PLAN.md`.** El plan
original decía "login del alumno + policies de fila". Al plantearle a Nalux el diseño (invitación
del profe → el alumno define contraseña → portal propio), la respuesta cambió el rumbo por
completo: *"del lado del alumno tendría que ser algo sencillo, que escanee el QR y vea documentos
[...] y poder descargarlos si quiere, para que les sirva a gente grande también, sino muchos van a
perder el acceso"*. Se descartó el login entero. Ver Decisión 20 para el detalle y sus
consecuencias en el roadmap (G3/G4 quedan bloqueados).

`supabase/migrations/0006_acceso_alumno_por_codigo.sql`: `alumnos.codigo_acceso` (128 bits,
`DEFAULT` de columna para cubrir los dos caminos de alta que tiene `alumnos` — staff manual y
`join_gimnasio_por_codigo()` de 0004 — sin tocar ninguna función existente), RPC pública
`ver_plan_por_codigo()` (la segunda función `anon` del proyecto) y `regenerar_codigo_acceso_alumno()`
(solo staff del propio gimnasio). Diseñada por `database-architect`, auditada por
`appsec-secure-coding`.

**Hallazgo real de la auditoría (severidad media), corregido ANTES de aplicar:** el rate-limit de
`ver_plan_por_codigo()` hacía el `UPDATE` del contador y recién después chequeaba el tope con un
`IF ... RAISE`. Como el `RAISE` hace rollback de la transacción entera, el contador nunca pasaba de
60 — o sea que SÍ limitaba los datos devueltos — pero el `UPDATE` abortado igual generaba una tupla
muerta en MVCC antes de deshacerse (el abort no evita la escritura física, solo la hace invisible).
Resultado: alguien con un código válido filtrado podía loopear la función sin techo generando WAL y
bloat sobre esa fila. **El rate-limit limitaba las lecturas pero no las escrituras, que es
exactamente lo que tiene que frenar.** Corregido moviendo el tope al `WHERE` del propio `UPDATE`
(mismo criterio atómico que ya usaba `regenerar_codigo_acceso_alumno()`): al llegar al tope no
matchea ninguna fila, cero escritura, y `NOT FOUND` corta. Verificado midiendo el contador después
de 65 llamadas: quedó en exactamente 60, confirmando que las 5 rechazadas no escribieron nada.

**Hueco funcional que encontré yo revisando el SQL antes de mandarlo a auditar** (no era de
seguridad, se habría descubierto recién con la app en manos de un alumno real): `rutinas.items`
guarda `ejercicioId` pero NO el `media_url` — el alumno habría leído "Sentadilla 4x10" sin poder
ver el video que el profe subió en el Bloque F, dejando esa feature entera sin ningún consumidor.
Consultado con Nalux y agregado: la RPC ahora enriquece cada item con su `mediaUrl` (defensivo:
valida que `items` sea array, compara `id::text` contra el JSON en vez de castear a UUID —un
`ejercicioId` malformado tiraría la página con un 500—, y preserva el orden con `WITH ORDINALITY`).

Frontend (`frontend-architect`): `MiPlanPage.jsx` en `/mi-plan/:codigo`, pública, sin `AuthContext`
ni `ProtectedRoute` (mismo criterio que `/unirse/:codigo`). Diseñada para el público objetivo:
tipografía grande, ningún texto por debajo de 14px, datos numéricos en `text-2xl`/`text-3xl`, sin
menú ni navegación, botón "Ver cómo se hace" bien destacado por ejercicio con video. Estilos de
impresión que sobreescriben las custom properties de color en el contenedor de la página (en vez de
forzar `!important` clase por clase) para que el modo oscuro no se imprima, con `break-inside: avoid`
para no cortar un ejercicio a la mitad entre páginas. Sección "QR para el alumno" en `AlumnoPage`,
calcando el patrón de `ConfiguracionPage` (QR client-side con `qrcode`, fondo blanco fijo, descarga,
regenerar con `window.confirm`).

Verificado de punta a punta contra la base real (datos de prueba "ZZZ" borrados después, confirmado
por SQL que la cuenta real quedó en cero): la RPC llamada literalmente como `anon` devuelve la
rutina y el plan correctos; `mediaUrl` llega poblado en el ejercicio con video y `null` en el que no
tiene, **sin romper**; un `ejercicioId` inexistente en la rutina tampoco rompe; el campo
`observaciones_salud` (cargado a propósito con "CONFIDENCIAL: no debe verse...") **no aparece en
ningún lado**, ni el teléfono ni el email (verificado inspeccionando el HTML renderizado, no solo la
respuesta SQL); código inválido, alumno dado de baja e intento de inyección SQL devuelven todos el
mismo mensaje genérico; `anon` no puede llamar `regenerar_codigo_acceso_alumno` (permiso denegado);
rate-limit corta exacto en la llamada 61; el botón "Regenerar código" de la UI cambia el link y el
QR al instante y deja el QR viejo muerto (confirmado abriendo la URL vieja después). Pantalla
probada además en viewport de celular (375x812), que es como la va a abrir el alumno.

**26/08/2026 (más tarde) — Bloque G5 terminado: cronómetro de descanso + calculadora de 1RM,
directo en `/mi-plan/:codigo`.** Sin cambios de schema — es 100% client-side sobre datos que la RPC
`ver_plan_por_codigo()` ya devolvía.

- **Cronómetro**: cada ejercicio con un `descanso` interpretable (texto libre del profe: "90 s",
  "1:30", "2 min"...) suma un botón "Iniciar descanso" que abre una cuenta regresiva grande, con
  beep (Web Audio API sintetizado, sin archivo de audio) + vibración al llegar a cero, pausa/reanuda
  y reinicio. Implementado contra un timestamp objetivo (`Date.now() + duración`), no restando 1
  por tick — así no se atrasa si el celular pone la pestaña en segundo plano mientras el alumno
  descansa. Si el texto de `descanso` no se puede interpretar como tiempo (ej. "a discreción"), el
  botón simplemente no aparece — mejor eso que un cronómetro mal armado.
- **Calculadora de 1RM**: fórmula de Epley (`peso × (1 + reps/30)`), con aviso explícito de que es
  una estimación y no una invitación a probar ese peso sin el profe — mismo criterio de público
  mayor/poco técnico de toda la pantalla.

**Bug que encontré yo revisando el código antes de probarlo** (no llegó a tocar la base real): si
dos ejercicios comparten exactamente el mismo texto de descanso ("90 s" los dos) y el alumno pide
el cronómetro del segundo mientras el del primero sigue corriendo, la duración en segundos —usada
como `key` de React— es idéntica, así que React no reemplaza el componente y el cronómetro viejo
seguía mostrando su cuenta a mitad de camino en vez de arrancar de nuevo. Corregido con un id
incremental por apertura en vez de la duración como `key`.

Verificado en vivo con datos de prueba (borrados después, confirmado por SQL en cero): "8 s" y
"1:30" muestran el botón, "a discreción" no; el cronómetro llega a 0:00, avisa "¡Descanso
terminado!" y deshabilita "Pausar"; pausado 3 segundos reales queda congelado en el mismo valor
(no sigue bajando) y "Seguir" retoma justo desde ahí; "Reiniciar" vuelve a la duración original; la
calculadora da 76 kg para 60 kg × 8 reps (coincide con Epley a mano) y rechaza 16 repeticiones
(fuera del rango 1-15) mostrando el aviso en vez de un resultado.

**26/08/2026 (mismo día, minutos después) — se sacó la calculadora de 1RM.** Nalux la vio en uso y
decidió que no hacía falta: el profesor ya le dice el peso al alumno, así que agregaba una pantalla
más sin necesidad real. Sacada por completo de `MiPlanPage.jsx` (componente, botón, estado e
import del ícono) — no quedó código muerto ni oculto. El cronómetro de descanso, que sí se probó y
gustó, queda como estaba. Build y lint limpios, y confirmado en vivo (con una cuenta descartable,
borrada después) que la calculadora ya no aparece y que "Descargar / Imprimir" e "Iniciar descanso"
siguen funcionando igual.

**26/08/2026 (mismo día, más tarde) — descarga de PDF separada por sección en `/mi-plan/:codigo`.**
Nalux pidió que el alumno pueda descargar solo la rutina o solo el plan de comida, no las dos
juntas en un PDF único. Se sacó el botón genérico "Descargar / Imprimir" de arriba y se puso un
botón "Descargar en PDF" propio junto al título de cada sección (`Tu rutina` / `Tu plan de
alimentación`), visible solo si esa sección tiene contenido.

Sigue sin hacer falta ninguna librería de PDF: se usa `window.print()` igual que antes, pero ahora
un estado (`imprimiendoSeccion`, `'rutina' | 'alimentacion' | null`) fija un `data-imprimiendo` en
el contenedor de la página, y una regla `@media print` nueva oculta la sección que no corresponde
justo para ese PDF — el header con el logo del gimnasio y el saludo se mantienen igual en los dos
casos. Fuera de impresión esto no afecta nada: en pantalla siempre se ven las dos secciones.

**Detalle de robustez que corregí yo mismo antes de probarlo, pensando en el público de celulares
poco técnicos:** la primera versión disparaba `window.print()` desde un `useEffect` enganchado al
valor de `imprimiendoSeccion`. El evento `afterprint` (estándar del navegador, dispara al cerrarse
el diálogo de impresión) se usa para volver ese estado a `null` después — pero si `afterprint` no
llegara a dispararse en algún navegador (pasa en ciertas versiones de iOS), el estado quedaría
trabado en, por ejemplo, `'rutina'`, y un segundo clic en el MISMO botón "Descargar en PDF" de la
rutina no volvería a llamar a `print()` (mismo valor de estado = React no re-dispara el efecto) —
el alumno se quedaría sin poder reintentar si canceló el diálogo la primera vez. Corregido: ahora
`print()` se llama directo en el `onClick` (vía `requestAnimationFrame`, para esperar al frame
donde el atributo ya está aplicado en el DOM), sin pasar por ningún `useEffect` condicionado al
valor — cada clic dispara el diálogo sin importar el estado anterior. `afterprint` sigue estando,
pero ahora es pura prolijidad (limpia el estado cuando se puede), nunca el mecanismo que gatilla
la impresión.

Verificado en vivo con una cuenta descartable (rutina + plan de alimentación reales, borrada
después): interceptando `window.print()` (igual que se hizo antes con `window.confirm`, porque el
diálogo nativo no es interactuable desde acá) se confirmó que el botón de cada sección fija el
`data-imprimiendo` correcto y que el selector CSS de "ocultar" matchea exactamente la sección
contraria — nunca la propia; y que dos clics seguidos en el mismo botón (sin cambiar de sección)
llaman a `print()` las dos veces, confirmando el fix del borde de arriba.

**26/08/2026 (cierre del día) — se cerraron las 7 preguntas abiertas de `PLAN.md`.** A pedido de
Nalux ("frenamos el bloque G, cerremos las preguntas abiertas"), se repasaron las 7 preguntas de
la sección "Preguntas abiertas para definir con vos": 2 ya estaban respondidas por el trabajo
hecho (rutinas como plantilla, mantener nutrición), y las 5 restantes se cerraron directamente con
Nalux. Ver Decisión 21 para el detalle completo de cada respuesta y sus consecuencias — resumen:
sin reservas/turnos (descarta también G9), SaaS a varios gimnasios (confirma que el branding
configurable y la futura facturación de Kairox tienen sentido real), pagos con carga directa del
profesor (cierra la Decisión pendiente 9 sin tocar código, y de hecho es la única opción compatible
con que el alumno no tenga login), una sola sede (descarta G8), y sin datos reales en PocketBase
para migrar (confirmado que `apps/pocketbase` se puede dar de baja).

Actualizado `PLAN.md` (checklist de G7-G9 y la sección de preguntas abiertas, todas marcadas con
su respuesta) y `CONTEXT.md` (sección 1: multi-tenant confirmado en vez de "decisión abierta",
Nivel 2 de aislamiento correctamente descripto como acceso por código en vez del login descartado,
PocketBase confirmado para dar de baja; sección 5: G7-G9 movidos de "pendiente" a
"resuelto/descartado", sacado el párrafo de preguntas sin responder). De paso, corregida una
inexactitud que noté al pasar: la sección 1 todavía decía que "Gestión GYM Kairox IA" era un
nombre temporal — ya es el nombre final, confirmado hace varios bloques.

No queda ninguna pregunta de negocio pendiente por ahora. El único trabajo futuro real que dejan
estas respuestas es la capa de facturación de Kairox a gimnasios clientes (Fase 3+, no ahora) —
anotado en `PLAN.md`, sección "Nota de negocio".

**31/08/2026 — Bloque G6 terminado: notificaciones segmentadas, y con esto se cierra el Bloque G.**
El profesor manda avisos por estado de cuota (o a todos), y el alumno los ve como cartel en su
`/mi-plan/:codigo` — mismo mecanismo sin login del Bloque G2, coherente con la Decisión 20.

`supabase/migrations/0007_notificaciones_segmentadas.sql`: tablas `notificaciones` (staff CRUD
completo) y `notificaciones_leidas` (staff **solo lectura** — esas filas nacen únicamente desde la
RPC pública, nunca vía PostgREST directo). Son las primeras tablas nuevas de `public.*` desde el
schema original de 0001 (0004/0005/0006 solo habían agregado columnas y funciones) — el `GRANT` a
nivel de tabla se incluyó desde el arranque, sin repetir el error histórico de 0001/0002.
`ver_plan_por_codigo()` extendida con 3 columnas nuevas (`aviso_id`/`aviso_titulo`/`aviso_mensaje`)
vía `DROP FUNCTION` + `CREATE OR REPLACE` (Postgres no deja agregar columnas a un `RETURNS TABLE`
existente de otra forma) — la lógica original (rate-limit, truncado, `mediaUrl`) quedó intacta,
verificado línea por línea contra 0006 en la auditoría. Nueva `marcar_notificacion_leida()` para
que el alumno descarte un aviso ("Entendido"), también pública y sin sesión.

**Decisión de diseño con Nalux antes de construir:** el diseño original (`gestiongym.shop`) usaba
6 categorías de audiencia, pero 2 (`con_deuda`/`sin_cuota`) no tenían ningún dato real conectado
en la app — `pagos.monto_adeudado` existe en el schema desde el Bloque A pero ninguna pantalla lo
carga todavía. Confirmado con Nalux: se construyen las 6 igual, sabiendo que "Con deuda" va a
mostrar 0 alumnos hasta que en algún momento se conecte la carga de pagos parciales.

**Hallazgo de la auditoría de `appsec-secure-coding` (severidad baja, corregido antes de aplicar):**
el cálculo del segmento del alumno (a partir de su pago con `periodo_hasta` más reciente) no tenía
desempate si dos pagos compartían exactamente la misma fecha — cuál "ganaba" dependía del plan de
ejecución de Postgres, no determinístico, así que el segmento calculado podía variar entre llamadas
para el mismo alumno sin que cambiara ningún dato real. Corregido agregando `p.created_at DESC`
como desempate. Sin hallazgos críticos ni altos — auditoría dio luz verde para aplicar.

Frontend: `AvisosPage.jsx` (`/avisos`) — crear aviso con selector de segmento que muestra la
audiencia en vivo ("Atrasados (3)"), lista de activos/archivados con "X/Y leyeron" por aviso,
archivar/reactivar (reversible, sin `window.confirm`). **Punto crítico de consistencia:** el
cálculo de audiencia en JS (`segmentoNotificacion()`, nueva en `format.js`) tiene que coincidir
EXACTO con lo que calcula la RPC en SQL — a propósito NO reutiliza `estadoDesdeVencimiento()` (la
lógica vieja de `DashboardPage`/`PagosPage`, que funde `sin_cuota`/`con_deuda` dentro de
`vencido`), sino una función nueva que replica el criterio fino de la migración. Cartel en
`MiPlanPage.jsx`: arriba del saludo, "Entendido" se resuelve 100% client-side sin recargar la
página (estado local `avisoOculto`), con manejo de error que no bloquea la pantalla si la RPC
falla. Aprovechado también para sacar "morosos"/"en mora" de los labels de segmento (badges
"Atrasados", igual criterio que el resto de la app desde el cambio de texto de hoy).

Verificado de punta a punta contra la base real, con la cuenta real de Nalux (sin gimnasio de
prueba — se cargaron alumnos "ZZZ" de prueba con distintos pagos, borrados después): el contador
de audiencia en vivo del selector coincidió exacto con la realidad, y de paso confirmó que la
distinción fina funciona en la práctica — la alumna real de Nalux (sin ningún pago cargado nunca)
cayó en "Sin cuota", no en "Atrasados", que es justo la diferencia que se buscaba. Creado un aviso
para el segmento "Atrasados": el alumno de ese segmento lo vio, uno "Al día" no; tocar "Entendido"
lo sacó de pantalla al instante sin recargar, y la pantalla de Avisos reflejó "1/1 leyeron" de
inmediato. "Archivar" lo movió a la sección de archivados con badge y botón "Reactivar". Datos de
prueba borrados, confirmado por SQL que solo queda la cuenta real de Nalux.

**31/08/2026 (más tarde) — primer bug reportado probando la app en vivo: la demostración de un
ejercicio "se abre pero no hay cómo volver a la app".** Nalux empezó a probar la app real y avisó
que al tocar "Ver demostración" en un ejercicio con imagen/video propio, el archivo se abría en
`target="_blank"` (pestaña nueva) — en el celular, sin una forma obvia de volver atrás, justo el
público "gente grande" para el que se diseñó todo el acceso por QR sin login. Corregido en las dos
pantallas que tienen este botón: `EjerciciosPage.jsx` (el "Ver demostración" del lado profe) y
`MiPlanPage.jsx` (el "Ver cómo se hace" del lado alumno, mismo bug, no reportado explícitamente
pero mismo origen — corregido igual antes de que alguien lo pise). Ahora, si el archivo es un
video o imagen subido a nuestro propio Storage (se detecta por `/object/public/ejercicios-media/`
en la URL), se abre en un modal adentro de la app (`<video controls>` o `<img>`, con botón de
cerrar) en vez de navegar afuera. Si en cambio es un link externo pegado a mano (YouTube, etc.),
se mantiene el comportamiento viejo de pestaña nueva, porque esos no se pueden embeber de forma
confiable.

Verificado en vivo contra la cuenta real de Nalux: en `/ejercicios`, "Ver demostración" en "Press
Frances" (imagen propia subida al Storage) abrió el modal correctamente y se cerró sin salir de la
app. Para probar el lado alumno hizo falta una rutina activa con ese ejercicio — no había ninguna
cargada, así que se insertó una rutina "ZZZ_test_preview" temporal por SQL, asignada a la alumna
real (nadia tecera) solo para la prueba; "Ver cómo se hace" en `/mi-plan/:codigo` abrió el mismo
tipo de modal correctamente. Rutina y asignación de prueba borradas después, confirmado por SQL
(`COUNT` en 0) que no quedó nada de prueba en la cuenta real. `npm run lint` y `vite build` limpios
antes de probar.

**31/08/2026 (cierre del día) — un ejercicio ahora puede tener más de un grupo muscular.** Pedido
de Nalux: `grupo_muscular` era un solo valor (un `<select>`), pero hay ejercicios que trabajan más
de un grupo (ej. peso muerto: Piernas + Espalda). Migración `0008_ejercicios_grupo_muscular_multiple.sql`
convierte la columna de `TEXT` a `TEXT[]` con un `USING` que envuelve cada valor existente en un
array de un elemento (NULL/vacío pasa a array vacío) — sin tocar RLS ni ninguna función ni los
GRANT de tabla, confirmado por grep contra las 8 migraciones que la columna no aparece en ninguna
policy ni función (la única lectura relacionada es `ver_plan_por_codigo()`, que lee `rutinas.items`,
una copia ya tomada al armar la rutina, no un join en vivo contra `ejercicios`).

Frontend en `EjerciciosPage.jsx`: el `<select>` de grupo se reemplazó por los mismos "pills"
tocables que ya se usaban para el filtro de arriba (ahora multi-selección, con al menos un grupo
obligatorio — si se intenta guardar sin ninguno, un cartel de error aparece adentro del modal, no
en el body de la página, porque el overlay del modal tapa por completo lo que hay atrás y ese
cartel quedaría invisible). La card de cada ejercicio ahora muestra un badge por cada grupo. El
filtro de arriba y la lista de ejercicios chequean con `.includes()` en vez de igualdad exacta.
En `RutinasPage.jsx`, el selector de "ejercicio de la biblioteca" y el registro que se copia a
`rutinas.items` al agregar un ejercicio unen los grupos con coma (`"Piernas, Espalda"`) — como
`rutinas.items` es una foto fija tomada al armar la rutina (no un join en vivo), `MiPlanPage.jsx`
y `AlumnoPage.jsx` siguen mostrando `it.grupo` como texto plano sin ningún cambio.

Verificado en vivo contra la cuenta real de Nalux: se le agregó "Espalda" a "peso muerto" (que ya
tenía "Piernas") desde el formulario, las dos pills quedaron marcadas, guardó bien y la card mostró
los dos badges; el filtro "Espalda" mostró "peso muerto" pero no "Press Frances". En el armador de
rutinas, el selector mostró "peso muerto · Piernas, Espalda" y, al agregarlo, el ejercicio en la
lista de la rutina mostró el mismo texto. Se probó también guardar un ejercicio nuevo sin ningún
grupo tildado: el cartel de error apareció dentro del modal y no dejó guardar. "peso muerto" se
devolvió a su estado original (solo "Piernas") por SQL al terminar, para no dejar la cuenta real
con un cambio que Nalux no pidió. `npm run lint` y `vite build` limpios antes de probar.

**31/08/2026 (mismo día, minutos después) — el video del modal de demostración se veía "muy
grande".** Nalux subió un video real (grabado con el celular, vertical) a "Peso Muerto" y avisó que
las imágenes se veían bien pero el video no. Causa: el modal de preview (`EjerciciosPage.jsx` y
`MiPlanPage.jsx`, del fix de hoy más temprano) usaba `w-full` — ancho fijo al 100% del modal, alto
libre en proporción a ese ancho. Con una imagen apaisada eso da un alto razonable; con un video
vertical (alto > ancho) el resultado es una caja gigante que no entra en la pantalla. Cambiado a
`max-h-[70vh] w-auto max-w-full h-auto`: el navegador elige el tamaño que entra a la vez en el
ancho del modal Y en el alto de la pantalla — funciona igual en celular que en computadora, y no
cambia nada para las imágenes que ya se veían bien (mismo criterio, caso general).

Verificado en vivo con el video real que Nalux subió a "Peso Muerto" (no hizo falta generar un
video de prueba): el modal lo mostró contenido dentro de la pantalla, sin desbordar, tanto en
tamaño de escritorio como emulando celular (375×812). Para probar el lado alumno se insertó una
rutina "ZZZ_test_video_size" temporal con ese mismo ejercicio, asignada a nadia tecera solo para la
prueba, y se vio igual de bien en `/mi-plan/:codigo`; rutina y asignación borradas después,
confirmado por SQL. `npm run lint` y `vite build` limpios.

**31/08/2026 (cierre) — 3 filtros nuevos en la biblioteca de ejercicios.** Nalux pidió investigar
qué filtros sumar antes de tocar nada. Investigación: comparé el estado actual (solo chips de
grupo muscular) contra el research original de la competencia en `PLAN.md` (que documenta un
buscador por nombre y un filtro por Origen propio/global) y contra el propio schema — encontré que
`ejercicios.clasificacion` (patrón de movimiento: empuje/tracción/dominante de cadera, etc.) existe
en la base **desde la migración 0001**, pensada para esto mismo, pero nunca se construyó ni el
campo para cargarla ni ningún filtro. De las 4 opciones que planteé (buscador, clasificación,
con/sin demostración, filtro por Origen) Nalux eligió las primeras 3 y descartó Origen (esa
implica un catálogo compartido entre gimnasios, feature más grande, no aplica al modelo actual).

Como `clasificacion` ya existía en la tabla, **esto no necesitó ninguna migración** — todo el
trabajo fue frontend. Se agregó `CLASIFICACIONES` a `format.js` (mismo criterio que `GRUPOS`),
con una lista propia de patrón de movimiento (empuje horizontal/vertical, tracción horizontal/
vertical, dominante de cadera/rodilla/tobillo, core, cardio, compuesto) — a propósito sin mezclar
músculos puntuales (bíceps, cuádriceps, etc.) como hacía la referencia, para no pisar el eje de
grupo muscular que ya existe. A diferencia de grupo muscular (que ahora es multi-selección),
`clasificacion` es un solo valor por ejercicio y opcional (no obligatorio como grupo).

En `EjerciciosPage.jsx`: buscador por nombre (`<Input>` con ícono, filtra por substring
case-insensitive) + 2 `<Select>` (patrón de movimiento, con/sin demostración) arriba de los chips
de grupo que ya existían. Los 4 filtros se combinan con AND. Los chips de grupo siguen siendo
chips (el filtro que más se usa, tap grande); patrón y demostración son selects más chicos para no
saturar la pantalla en el celular. El formulario de alta/edición suma "Patrón de movimiento
(opcional)" con "Sin clasificar" como default. La card de cada ejercicio muestra el patrón (si
tiene) como texto chico en mayúscula, antes de la descripción.

Verificado en vivo contra la cuenta real de Nalux: buscar "press" mostró solo "Press Frances";
filtrar "Sin demostración" no mostró nada (los 3 ejercicios reales ya tienen media cargada, esperable);
se editó "Peso Muerto" para asignarle "Dominante de cadera", guardó bien, apareció en la card, y el
filtro por ese patrón mostró solo ese ejercicio — después revertido a "Sin clasificar" por SQL para
no dejar un dato que Nalux no pidió. Probado también en 375×812 (celular): los 3 controles se
apilan en columna, sin desbordar. `npm run lint` y `vite build` limpios antes de probar.

**Nuevo acuerdo de flujo de trabajo (02/09/2026):** a partir de acá, Nalux prueba cada cambio en
local (`localhost:3001`) y avisa explícitamente cuándo subirlo a GitHub para que Vercel lo
despliegue — se descontinúa el patrón anterior de commitear y pushear cada fix apenas quedaba
verificado. Los cambios de abajo (filtro de patrón sacado de la lista de ejercicios, y todo el
bloque de "alumnos: 5 campos/mejoras nuevos") quedaron listos y verificados en local, pero **sin
subir a git** hasta que ella lo pida.

**02/09/2026 — se sacó el filtro de "patrón de movimiento" de la lista de ejercicios (quedó solo el
campo).** Nalux probó el filtro nuevo y pidió sacarlo — pero aclaró que el campo del formulario
(para poder seguir etiquetando ejercicios) se queda. En `EjerciciosPage.jsx`: se sacó el `<Select>`
del filtro y el estado `filtroClasificacion`; el campo "Patrón de movimiento (opcional)" del
formulario, la clasificación en la card, y la columna en la base **no se tocaron**. Verificado en
local: la biblioteca quedó con buscador + con/sin demostración + chips de grupo, y el formulario de
alta/edición sigue teniendo "Patrón de movimiento". `npm run lint` y `vite build` limpios.

**02/09/2026 (mismo día) — investigación de "Alumnos" + 6 mejoras a pedido de Nalux.** Mismo
método que con ejercicios: investigué el código actual (`AlumnosPage.jsx`/`AlumnoPage.jsx`), la
base de datos y el research original en `PLAN.md` antes de tocar nada. Dos hallazgos:
`alumnos.fecha_nacimiento` era **otro campo fantasma** — existe desde la migración 0001, puesta ahí
específicamente para el aviso de "cumpleaños de hoy" que el research marcó como destacable, pero
nunca se construyó ni el campo para cargarla ni el aviso; y `email` se podía cargar en el
formulario pero no se mostraba en ningún lado. Nalux pidió las 6 mejoras planteadas, con el DNI
opcional ("no sé para qué puede servir en un gimnasio").

Migración `0009_alumnos_datos_extra.sql`: 3 columnas nuevas en `alumnos` — `dni`, `contacto_emergencia`,
`objetivo`, las 3 `TEXT` nullable, sin `UNIQUE` en `dni` a propósito (es un dato de referencia, no la
fuente de verdad de identidad del alumno). `fecha_nacimiento` no se tocó, ya existía. Sin impacto en
RLS/GRANT (mismo razonamiento que la migración 0008 de ejercicios).

Frontend:
- **Cumpleaños**: `fecha_nacimiento` ahora se carga en el formulario de `AlumnosPage.jsx` (con nota
  de para qué sirve) y se calcula en `DashboardPage.jsx` (compara mes+día contra hoy, ignora el
  año). Un banner con ícono de torta aparece arriba de todo el panel, **solo** si hay al menos un
  cumpleañero hoy (no ocupa lugar los otros 364 días del año) — link directo a la ficha de cada uno.
- **Email visible**: se agregó a la card del listado (`AlumnosPage.jsx`) y a la ficha
  (`AlumnoPage.jsx`, sección nueva "Datos personales").
- **Filtro de estado**: chips "Todos / Activos / Pendientes / Inactivos" en `AlumnosPage.jsx`,
  mismo criterio que ya usaba el badge de cada card (`ESTADO_ALUMNO()`, nueva función). Se combina
  con la búsqueda por nombre. Mensaje de "sin resultados" ahora distingue "no hay ningún alumno
  cargado" de "no hay alumnos que coincidan con estos filtros" (mismo ajuste que se había hecho en
  ejercicios).
- **DNI, contacto de emergencia, objetivo**: 3 campos nuevos en el formulario, todos opcionales,
  sin ninguna validación especial. `objetivo` también se muestra en la card del listado (dato corto,
  útil de un vistazo); `dni` y `contacto de emergencia` solo en la ficha completa (`AlumnoPage.jsx`,
  misma sección "Datos personales" que el email), para no saturar la card de la lista.
- Bug chico evitado antes de probar: `fecha_nacimiento` es `DATE` en la base — un `''` (input vacío)
  rompe el insert/update ("invalid input syntax for type date"), a diferencia de un campo `TEXT`
  donde `''` es válido. `guardar()` convierte `'' → null` antes de mandar el payload.

Verificado en vivo contra la cuenta real (2 alumnos de prueba, "Alumno 1"/"Alumno 2" — Nalux los
había renombrado desde la sesión de pruebas anterior, no hubo ninguna pérdida de datos ahí, solo
verificación de que el patrón "renombrar en vez de crear" seguía dando los mismos IDs): filtro de
estado probado (Pendientes dio "sin resultados" correctamente, ambos alumnos son manual+activo);
se cargaron los 5 campos nuevos en "Alumno 1" con fecha de nacimiento = hoy, guardó bien, apareció
"Objetivo" en la card, la ficha mostró los 5 en "Datos personales", y el Dashboard mostró el
banner "Hoy cumple años Alumno 1." Datos de prueba revertidos por SQL después (los 4 campos
nuevos volvieron a NULL), confirmado que el banner desaparece limpio sin dejar hueco cuando no hay
cumpleañeros. `npm run lint` y `vite build` limpios antes de probar. **No subido a git — Nalux
prueba en local primero y avisa cuándo subirlo (ver acuerdo de flujo de arriba).**

**02/09/2026 (mismo día, más tarde) — "Pendiente de aprobación" más visible.** Nalux probó el
formulario de alta y preguntó "¿cuáles serían los alumnos pendientes? porque solo puedo ponerlos
como activos o inactivos" — confusión legítima: el checkbox "Alumno activo" del formulario nunca
pone a nadie en "Pendiente", ese estado es exclusivo del flujo de autorregistro por QR (Bloque E,
`origen = 'autorregistro' AND activo = false`) y se resuelve con "Aprobar" desde la lista, no desde
el formulario. Le pregunté el alcance (solo hacerlo más visible, o además dejar que el profe
también pueda marcarlo a mano) — eligió **solo hacerlo más visible**, sin agregar una forma manual
de marcar "Pendiente" (ese estado se mantiene 100% automático).

Tres cambios, todo frontend, sin migración:
- `AlumnosPage.jsx`: los 4 chips de filtro ahora muestran la cantidad al lado ("Activos (2)",
  "Pendientes (1)", etc. — nuevo `conteos` con `useMemo`), y el chip "Pendientes" suma un punto
  naranja cuando hay al menos 1 y no es el filtro activo, para que salte a la vista sin tener que
  leer el número. Se agregó una nota debajo del checkbox "Alumno activo" explicando en el propio
  formulario, con las palabras de Nalux, por qué no hay una opción para elegir "Pendiente" ahí.
- `DashboardPage.jsx`: banner nuevo (mismo patrón que el de cumpleaños de la entrada anterior,
  pero en color `warn` en vez de `primary` — mismo criterio de color que ya usaba el badge de
  "Pendiente" en la card) que aparece solo si hay alumnos esperando aprobación, con link directo a
  `/alumnos`. Aparece arriba del banner de cumpleaños (más urgente/accionable primero).

Verificado en vivo: como no había ningún alumno pendiente real, se simuló uno por SQL (
`origen = 'autorregistro'` en un alumno de prueba existente) para ver el chip con conteo y punto
naranja, el badge en la card, y el banner del Dashboard con su link a `/alumnos` — los tres
aparecieron correctos, revertido el `origen` después por SQL. `npm run lint` y `vite build`
limpios. **Tampoco subido a git.**

**02/09/2026 (mismo día, más tarde) — "Pendiente" ahora se puede marcar a mano, no solo por
autorregistro.** Nalux hizo una observación importante: cuando alguien se autorregistra por QR
(`UnirsePage.jsx`), la pantalla de confirmación solo dice "ya avisamos a tu profe" — **nunca le
muestra su propio código/QR de acceso** (`ver_plan_por_codigo()` exige `activo=true`, y en ese
momento el alumno todavía está `activo=false`). Confirmé el flujo completo: no es un dead-end,
porque el profesor puede compartirlo manualmente después desde la ficha del alumno (`AlumnoPage.jsx`
ya tiene "QR para el alumno" con link para copiar), pero es un paso manual, no automático. A partir
de esto, Nalux pidió simplificar: que el profesor pueda cargar y marcar "Pendiente" directamente
(ej. "se anotó pero no arrancó todavía"), no solo como resultado del autorregistro — y un ícono de
info que explique qué significa cada uno de los 3 estados.

Migración `0010_alumnos_pendiente_manual.sql`: nueva columna `alumnos.pendiente BOOLEAN NOT NULL
DEFAULT false`, independiente de `origen` (antes "Pendiente" se inferia de
`origen='autorregistro' AND activo=false`; ahora es su propio flag, así el profesor lo puede
prender/apagar en cualquier alumno, manual o autorregistrado). `join_gimnasio_por_codigo()`
(0004) se actualizó con `CREATE OR REPLACE` para dejar `pendiente=true` en el INSERT de
autorregistro — sin tocar el resto de la lógica (rate limit, validación de código), comparado
línea por línea contra el original antes de aplicar. Probado con `SET ROLE anon` contra la función
real: el autorregistro sigue funcionando igual y ahora deja `pendiente=true`, dato de prueba
borrado después.

Regla de lectura centralizada en `format.js` (`estadoAlumno()` + `ESTADOS_ALUMNO`, mismo patrón que
`ESTADOS_PAGO`): `activo` siempre gana (un alumno activo nunca se lee "pendiente" aunque el flag
haya quedado prendido de antes), si no `pendiente` gana, si no es `inactivo`. Usado ahora en las 3
pantallas (antes cada una tenía su propia lógica ligeramente distinta — `AlumnoPage.jsx`, por
ejemplo, ni siquiera distinguía "Pendiente" en su badge, solo Activo/Inactivo, un bug chico que
esto de paso corrigió).

Frontend:
- `AlumnosPage.jsx`: el checkbox "Alumno activo" se reemplazó por un selector de 3 estados
  (Activo/Pendiente/Inactivo, mismos "pills" que ya se usaban en otros lados de la app) — al
  elegir "Pendiente" pone `activo=false, pendiente=true`. El botón "Aprobar" pasó a llamarse
  "Activar" (ya no es específico de autorregistro) y ahora aparece para cualquier alumno en estado
  pendiente, sea cual sea su origen; al activarlo también apaga el flag `pendiente`.
- Ícono de info (ⓘ) al lado de los chips de filtro: al tocarlo abre/cierra un cartel con la
  explicación de qué significa cada estado, con las palabras de Nalux ("Pendiente: cargado pero
  todavía no arrancó — se autorregistró por QR y falta aprobarlo, o lo marcaste así a propósito").
- `DashboardPage.jsx`: el banner de pendientes (de la entrada anterior) ahora dice "N alumnos
  pendientes — todavía no arrancaron o están esperando que los actives" en vez de asumir que
  siempre vienen del QR.

Verificado en vivo: se marcó "Alumno 2" (real, estaba Inactivo) como "Pendiente" a mano desde el
formulario — el badge, el contador del chip, y la ficha (`AlumnoPage.jsx`) lo mostraron correcto,
incluso confirmando de paso que la ficha SÍ tiene el QR para compartir manualmente. Se probó
también el botón "Activar", que lo pasó a Activo correctamente. Todo revertido después por SQL a
su estado real anterior (Inactivo, sin pendiente). `npm run lint` y `vite build` limpios. **Tampoco
subido a git.**

**02/09/2026 (cierre) — Bloque de mejoras a Rutinas (9 cosas, sin ninguna migración).** Nalux pidió
investigar la sección de rutinas ("está un poco pelada") comparándola contra las apps de
referencia, y después implementar todo lo que salió. La investigación salió casi entera de
`PLAN.md` sección 1.2, que ya tenía documentado el armador de la competencia (`gestion_rutinas.php`,
marcado ahí como "el módulo más fuerte" y "donde está la mayor distancia respecto a lo que
tenemos"). Contra eso, faltaban: buscador, duplicar, exportar PDF, reordenar ejercicios, bloques
con nombre libre dentro del día, semanas (rutina que cambia semana a semana), comentario del
profesor e intensidad por ejercicio, la fecha de inicio de la asignación y el historial de rutinas
anteriores del alumno.

**Todo entró sin tocar el schema**: `rutinas.items` es JSONB libre, así que `semana`, `bloque`,
`intensidad` y `comentario` son campos nuevos dentro de cada item; `rutinas_asignadas.fecha_inicio`
ya existía (y encima con `DEFAULT CURRENT_DATE`, o sea que el dato siempre se guardó bien — lo que
faltaba era mostrarlo); y el historial sale de las asignaciones con `activa = false`, que ya se
generaban desde el Bloque G ("Cambiar rutina" nunca borró la fila, justamente la desactiva).

**Retrocompatibilidad, el punto delicado:** las rutinas ya armadas no tienen ninguno de los campos
nuevos. Por eso toda la lectura pasa por helpers compartidos nuevos en `format.js`
(`semanaDeItem()`, `agruparPorBloque()`, `agruparItemsRutina()`) que aplican defaults: un item sin
`semana` cuenta como semana 1, uno sin `bloque` cae en un grupo sin encabezado. Verificado con la
rutina real de Nalux ("Rutina baja intensidad", armada antes de todo esto): se sigue viendo
exactamente igual que siempre.

**Decisión de diseño para no ensuciar la pantalla del alumno:** los encabezados de semana solo
aparecen si la rutina realmente usa más de una. Una rutina de una sola semana (el caso normal) se
ve igual que antes, sin ninguna capa extra — es el mismo criterio que la referencia resolvía con
dos modos ("por semanas" vs "rutina fija"), pero sin obligar al profe a elegir un modo: se deduce
de lo que armó.

En `RutinasPage.jsx`: buscador por nombre; "Duplicar" (copia con "(copia)" en el nombre y **sin**
arrastrar las asignaciones, así el profe versiona tranquilo sin tocar lo que ya tienen los
alumnos); "PDF" que imprime UNA rutina entera (tabla por día, con bloques y comentarios) usando el
truco de `visibility` en vez de `display:none`, porque esconder el body con display rompería el
layout de lo que sí se quiere imprimir; selector de Semana y campo Bloque al agregar un ejercicio;
y por ejercicio, campos de Intensidad, Bloque y "Comentario para el alumno" más flechas ↑/↓ para
reordenar dentro de su propio día.

En `AlumnoPage.jsx`: la vista de solo lectura ahora agrupa igual (semana → día → bloque) y muestra
intensidad y comentario; la tarjeta de la rutina dice "desde el DD/MM/AAAA"; y se agregó la sección
"Rutinas anteriores". A propósito el historial solo muestra desde cuándo la tenía y no hasta
cuándo: no hay columna de fecha de baja, e inventar una fecha de fin a partir de otra cosa sería
mentir. También se corrigió de paso que la ficha nunca mostraba el estado "Pendiente" (solo
Activo/Inactivo), ahora usa el mismo `estadoAlumno()` que el resto.

En `MiPlanPage.jsx` (lado alumno): misma agrupación, con el comentario del profe destacado en un
recuadro grande (es un mensaje para el alumno, no un dato más) e intensidad como línea aparte.

Verificado en vivo de punta a punta contra la base real, sobre una rutina duplicada de prueba para
no tocar la de Nalux: se agregó un ejercicio en Semana 2 con bloque "Entrada en calor", se cargó
comentario e intensidad, se reordenaron dos ejercicios (confirmado por SQL que el orden quedó
intercambiado en el JSONB y que los items viejos siguen sin campo `semana`), se generó el PDF
interceptando `print()` para leer la hoja (salió con semanas, bloques, tabla y comentario), se
probó el buscador, y del lado del alumno se vio la agrupación completa. El historial se verificó
cambiando la rutina de un alumno descartable. Todos los datos de prueba borrados después
(confirmado por SQL: queda 1 rutina, 3 alumnos, y la única asignación activa es la real de
Nalux). `npm run lint` y `vite build` limpios. **No subido a git — sigue vigente el acuerdo de que
Nalux prueba en local y avisa cuándo subirlo.**

**02/09/2026 (cierre, más tarde) — el armador de rutinas pasó a ser por día, con selección
múltiple de ejercicios (para superseries) y días explícitos.** Dos pedidos seguidos de Nalux sobre
el armador recién terminado:

1. *"quiero que en vez de seleccionar un solo ejercicio, se puedan seleccionar varios, porque
   algunos pueden ser superseries y así"* — antes el selector era un único `<Select>`, un
   ejercicio por click.
2. *"que en el mismo bloque se puedan ir agregando los ejercicios, en vez de tenerlo arriba... y
   otro que diga de agregar día"* — el buscador de agregar vivía fijo arriba de todo el modal,
   lejos de la tarjeta que iba creciendo abajo a medida que se cargaban ejercicios; y pidió que los
   días de la rutina sean explícitos ("Día 1", "Día 2"...) en vez de aparecer solos al elegir un
   día en un desplegable.

Nalux también describió en el mismo mensaje el modelo de "armar el plan una vez, ponerle cuántas
semanas dura, y tenerlo para varias personas, agregando los alumnos que tiene cada plan" — eso
**ya existe tal cual** desde el Bloque G (`duracion_semanas` + "Asignar a alumnos" + contador de
alumnos en la card), no hizo falta tocar nada ahí; se lo confirmé para que quede claro que no es
un pedido nuevo sin atender.

**Rediseño del armador, sin cambiar el modelo de datos** (`rutinas.items` sigue siendo el mismo
JSONB, con las mismas claves de la entrada anterior): el modal pasó de "un buscador fijo arriba +
una vista de solo-lectura con TODOS los días abajo" a un **editor por día**: arriba, los días de la
rutina como chips (`diasRutina`, nuevo estado — antes los días eran implícitos, se inferían de lo
que hubiera en `items`) con un botón "Agregar día" que suma el siguiente día libre de `DIAS` y lo
deja seleccionado; si la rutina usa varias semanas, debajo aparecen también chips de semana. Elegido
un día (y semana), una sola tarjeta muestra sus ejercicios ya cargados (agrupados por bloque, cada
uno editable: series/reps/peso/descanso/intensidad/bloque/comentario, con las flechas ↑/↓ de la
entrada anterior) y **justo debajo, en la misma tarjeta**, el buscador para seguir agregando: campo
de texto + lista con checkbox por ejercicio + campo de bloque + botón "Agregar (N)". Como el
buscador vive al final de la tarjeta, cada ejercicio nuevo aparece arriba de él — el buscador se
va corriendo hacia abajo con el bloque que se arma, nunca queda separado arriba de todo.

Selección múltiple real: se tilda cualquier cantidad de ejercicios y "Agregar (N)" los suma todos
juntos, en el orden en que aparecen en la lista, al mismo día/semana/bloque elegidos — exactamente
lo que hace falta para cargar una superserie de una. Al cambiar de día (tanto tocando un chip
existente como con "Agregar día") el campo Bloque se limpia solo, para no arrastrar el nombre de un
bloque del día anterior; cambiar de semana sí lo conserva, porque ahí puede tener sentido repetir
el mismo bloque semana a semana.

Verificado en vivo sobre una rutina de prueba (`ZZZ_test_multiselect`, vacía): se tildaron 2
ejercicios a la vez con bloque "Superserie" en Día 1, se confirmó que "Agregar" mostraba el
contador ("Agregar (2)") y que ambos entraron juntos al mismo bloque; se agregó Día 2 con
"Agregar día" y se confirmó que el campo Bloque había quedado vacío (primero falló — `agregarDia()`
llamaba a `setDia()` directo, sin pasar por el `onClick` del chip que sí lo limpiaba — corregido
agregando el mismo `setBloque('')` ahí); se repitió la prueba también volviendo a un chip de día ya
existente. Guardado y confirmado por SQL: el JSONB quedó con los 2 ejercicios de Día 1 en bloque
"Superserie" y el de Día 2 en su propio bloque, cada uno con su `dia`/`semana`/`bloque` correctos.
Rutina de prueba borrada después. `npm run lint` y `vite build` limpios. **Tampoco subido a git.**

**02/09/2026 (cierre, más tarde todavía) — "seleccionar varios ejercicios" en realidad era pedir
superseries combinadas en una sola tarjeta.** Nalux aclaró con un ejemplo concreto lo que había
pedido antes: no alcanzaba con agregar varios ejercicios juntos bajo el mismo bloque (lo que ya
estaba armado) — quería que se **vean como una sola tarjeta combinada**: "peso muerto + Búlgara,
3 series, 10 repeticiones + 8 repeticiones con cada pierna" (mismas series para los dos porque van
en el mismo combo, reps distintas porque Búlgara es unilateral).

**Diseño: `comboId`, no `bloque`.** `bloque` sigue siendo una etiqueta de texto libre para
organizar (como ya estaba); combinar dos ejercicios en una tarjeta es una señal aparte, más
explícita: cuando se tildan 2+ ejercicios y se agregan juntos con un solo click de "Agregar (N)",
esos items comparten un `comboId` nuevo (`combo-<timestamp>`) además de su `bloque`. Cargar un
ejercicio solo, o los mismos dos pero en clicks separados, no genera `comboId` — quedan como
tarjetas independientes aunque compartan bloque. Evita el problema de "cualquier bloque con 2+
ejercicicios se fusiona sola" (que hubiera roto bloques usados solo para organizar, no para
combos reales) y hace que fusionar sea un gesto explícito del profesor, no una inferencia.

Nuevo `agruparCombos()` en `format.js` (mismo criterio de "no migrar nada, solo helpers con
default" que ya usan `agruparPorBloque()`/`agruparItemsRutina()`): agrupa items consecutivos con
el mismo `comboId` y fusiona sus valores en un solo objeto -- **series se muestra una sola vez si
todos coinciden, si no se unen con "+"; reps/peso/intensidad siempre se unen con "+" (uno por
ejercicio, en el mismo orden que el nombre)**; nombre y grupo también se unen/deduplican;
comentario se concatena con "·". Se usa SOLO en las 3 pantallas de solo lectura (MiPlanPage,
AlumnoPage, el PDF de `RutinasPage`) -- el armador sigue editando cada ejercicio por separado
(series/reps/peso propios), porque ahí sí hace falta tocar cada campo individualmente; ahí lo único
que cambia es una caja visual "COMBO (N ejercicios)" alrededor de los que comparten `comboId`, para
que el profesor vea que están vinculados mientras los edita.

Dos detalles resueltos al implementar:
- **Video de demostración por combo**: un combo tiene 2 ejercicios, cada uno con su propio video
  potencial -- en vez de un solo botón "Ver cómo se hace" (que no tendría sentido, ¿cuál de los
  dos?), se muestra un botón por cada ejercicio del combo que tenga su propio `media_url`, con su
  nombre ("Ver Peso Muerto"). Nuevo componente `BotonVerDemo` en `MiPlanPage.jsx` que reusa la
  misma lógica de antes (`tipoDePreview`), ahora parametrizada.
- **Cronómetro de descanso**: si el descanso de los ejercicios del combo no coincide, queda
  combinado con "+" (ej. "60 s + 90 s") -- en ese caso NO se ofrece el botón de cronómetro, porque
  sería ambiguo cuál de los dos tiempos arrancar. Si coinciden (el caso normal, se descansa una vez
  después de terminar el combo), el cronómetro funciona igual que siempre.

Verificado en vivo de punta a punta contra el ejemplo exacto de Nalux, sobre una rutina y un
alumno descartables: se tildaron Búlgara + Peso Muerto juntos (bloque "Superserie"), en el
armador apareció la caja "COMBO (2 ejercicios)"; se les puso 3 series a los dos y reps "10" /
"8 c/pierna" por separado; guardado y confirmado que la vista del alumno mostró exactamente
"Búlgara (cuadriceps) + Peso Muerto" / "3" series / "8 c/pierna + 10" reps / un botón "Ver Peso
Muerto" (Búlgara no tiene video cargado) / cronómetro funcionando (mismo descanso en los dos); la
ficha del profesor y el PDF mostraron lo mismo combinado. Datos de prueba borrados después,
confirmado por SQL que solo quedan las 3 rutinas/alumnos reales. `npm run lint` y `vite build`
limpios. **Tampoco subido a git.**

**02/09/2026 (cierre, más tarde todavía) — corrección: la superserie no va fusionada en un texto,
va cada ejercicio en su propia caja chica, lado a lado.** Nalux corrigió el diseño anterior: "no no
entendiste... es un ejercicio al lado del otro... achica las cajas para que entre todo". El
combo NO se muestra como "Búlgara + Peso Muerto / 3 series / 8+10 reps" (un solo renglón de texto
fusionado, lo que se había hecho antes) sino como **dos cajas chicas, una al lado de la otra,
conectadas con un "+"**, cada una con su propio nombre/series/reps/peso — descanso, intensidad y
comentario sí se comparten abajo, porque son del combo entero (el descanso pasa una sola vez, al
terminar los dos ejercicios de la vuelta).

`agruparCombos()` en `format.js` se reescribió: ya NO fusiona nombre/series/reps/peso en texto
(eso vuelve a ser por-ejercicio, vía `comboItems` sin tocar) — solo combina descanso/intensidad/
comentario, y con `combinarValor()` como red de seguridad nomás (en la práctica siempre vienen
iguales, ver el punto siguiente). El PDF (`RutinaImprimible`) se revirtió a NO fusionar nada: cada
ejercicio en su fila de tabla, el encabezado de bloque ("Superserie") ya alcanza para que se
entienda que van juntos en papel.

**Los campos compartidos ahora se editan una sola vez y se propagan.** En el armador
(`RutinasPage.jsx`), `editarItem()` ahora distingue: `series`/`reps`/`peso` solo tocan el ejercicio
que se está editando; `descanso`/`intensidad`/`bloque`/`comentario` (`CAMPOS_COMPARTIDOS_EN_COMBO`)
se propagan a TODOS los ejercicios con el mismo `comboId`. Sin esto, el campo compartido que se ve
una sola vez en la UI hubiera actualizado solo uno de los dos ejercicios en los datos, y habrían
terminado con descansos distintos sin que se notara hasta imprimir o ver el plan.

El armador también se rediseñó: un combo ahora muestra sus ejercicios en cajas chicas lado a lado
(nombre + Series/Reps/Peso en 3 columnas angostas, con su propio botón de eliminar), separadas por
un "+", y UNA sola fila de Descanso/Intensidad/Comentario compartidos debajo — en vez de dos
tarjetas completas apiladas como antes. `MiPlanPage.jsx` y `AlumnoPage.jsx` (las 2 pantallas de
solo lectura) siguen el mismo patrón visual, adaptado al estilo de cada una.

**Ajuste tras la primera prueba en celular:** las cajas usaban `flex-wrap` con un ancho mínimo fijo
(`min-w-[8.5rem]`), que en un celular angosto (375px) hacía que se apilaran una debajo de la otra
en vez de quedar en la misma línea — justo lo que Nalux pidió evitar. Cambiado a `flex` sin wrap +
`min-w-0` + `truncate` en el nombre: así el navegador SIEMPRE las mantiene en una sola fila,
comprimiendo el ancho de cada caja (y truncando el nombre con "..." si hace falta) en vez de
mandar la segunda caja a una fila nueva. Se aplicó igual en `MiPlanPage.jsx` y `AlumnoPage.jsx`; en
el armador (`RutinasPage.jsx`) se dejó el fallback a apilarse en pantallas muy angostas, porque ahí
son campos editables de verdad (inputs), no texto, y es una herramienta de trabajo que en la
práctica se usa más en computadora.

Verificado en vivo de nuevo con el mismo ejemplo (Búlgara + Peso Muerto, 3 series, 8 c/pierna + 10)
sobre datos descartables: en el armador aparecieron las dos cajas chicas lado a lado con el "+", el
descanso editado en una se reflejó en la otra automáticamente; guardado y confirmado en las 3
pantallas de lectura que se ven en una sola línea, tanto en escritorio como en 375px de ancho (antes
del ajuste se apilaban a ese ancho, después ya no). Datos de prueba borrados, confirmado por SQL
que solo quedan las 3 rutinas/alumnos reales. `npm run lint` y `vite build` limpios. **Tampoco
subido a git.**

**02/09/2026 (cierre de la sesión) — PDF con el formato de Nalux, plan de alimentación
rediseñado por completo, y vencimiento de planes con avisos en el panel general.** Nalux trajo
dos PDF de ejemplo (una rutina y un plan de comida, armados aparte) y pidió que el sistema
descargue y arme los planes así. Investigación rápida: la RUTINA ya calzaba con el modelo que se
armó hoy (bloques + superseries), era 100% un cambio de cómo se ve el PDF; el PLAN DE COMIDA era
distinto de raíz — hoy se cargaban alimentos sueltos con gramos/calorías de una biblioteca, el
ejemplo es "Comida N.º 1 (elegir una opción)" con alternativas en texto libre + "Observaciones
generales". Le pregunté el alcance del cambio de dieta (reemplazar el modelo actual, o tener las
dos formas) — eligió reemplazar.

**PDF, rediseño completo (antes imprimía el mismo DOM de pantalla, ahora hojas dedicadas):**
`MiPlanPage.jsx` imprimía literalmente lo que se veía en pantalla (tarjetas grandes, cajas de
colores) apagando el modo oscuro con variables CSS. Se reemplazó por el mismo criterio que
`RutinaImprimible` de `RutinasPage.jsx`: dos componentes nuevos (`RutinaImprimiblePDF`,
`PlanAlimentacionImprimiblePDF`), montados aparte y ocultos en pantalla (`.mp-hoja { display:none }`
+ `body * { visibility:hidden }` en `@media print`, mismo truco de visibility en vez de
display:none para no romper el layout del resto de la página). Rutina: tabla "Ejercicio | Series x
Reps" por bloque (combos se combinan en el texto -- "3x12+10" -- exactamente como pidió Nalux con
su propio ejemplo), banda de color por día, rango de fechas arriba ("2/9 – 30/9", calculado de
`fecha_inicio` + `duracion_semanas`). Comida: bandas "Comida N.º X (elegir una opción)" + viñetas,
"Observaciones generales" al final. Los dos usan el color de marca real del gimnasio
(`gimnasio_color_principal`, con `#E10600` de fallback) y ahora también el logo real
(`gimnasio_logo_url`, pedido aparte en el mismo hilo) -- ambos datos ya venían de
`ver_plan_por_codigo()` pero nunca se usaban en el PDF, solo en la pantalla.

**Bug encontrado y corregido en la propia verificación:** el rango de fechas salía "2/9 – " (sin
la fecha de fin) -- `sumarDias()` devolvía un objeto `Date`, pero `fmtFechaCorta()` espera un
string; `String(date)` no es un ISO parseable, así que fallaba en silencio y devolvía `''`. Se
corrigió haciendo que `sumarDias()` devuelva el string ISO directo.

**`ver_plan_por_codigo()` (migración 0011):** se agregó `rutina_fecha_inicio` (ya existía en
`rutinas_asignadas` desde 0001, nunca se devolvía) para poder calcular el rango de fechas del PDF.
`DROP FUNCTION` + `CREATE` porque cambia la firma de `RETURNS TABLE` (mismo motivo que 0007) --
se repitió el `GRANT EXECUTE` a `anon`/`authenticated` explícito después de recrearla (verificado
antes y después con `SET ROLE anon` que la función sigue siendo invocable sin sesión).

**Plan de alimentación, modelo nuevo:** `planes_alimentacion.items` pasó de "alimentos sueltos con
gramos/calorías de una biblioteca" a un array de comidas `{ key, opciones: [texto, texto...] }` --
el número de comida es la posición en el array + 1, no un campo propio (reordenar con ↑/↓ renumera
solo). "(elegir una opción)" se muestra solo si `opciones.length > 1`, no es un campo aparte. Se
reusó `planes_alimentacion.notas` para "Observaciones generales" (un renglón por observación,
viñeta al mostrarla) -- esa columna existe desde el arranque del proyecto y ya la devolvía
`ver_plan_por_codigo()` como `plan_notas`, pero ningún formulario la exponía: otro campo fantasma
como los que se vinieron encontrando toda la sesión (`clasificacion`, `fecha_nacimiento`), así que
esto **no necesitó ninguna migración**. La biblioteca de alimentos (`/alimentos`, con calorías)
sigue existiendo intacta, solo se dejó de usar para armar planes -- `PlanAlimentacion` en
`AlumnoPage.jsx` se reescribió por completo (agregar/quitar/reordenar comidas y opciones), y la
carga de la biblioteca de alimentos se sacó de `AlumnoPage.jsx` por quedar huérfana.

**Vencimiento de planes (pedido aparte, en el mismo hilo): fecha de inicio y fin por alumno, con
aviso en el panel general.** Migración `0012_vencimiento_planes.sql`: `rutinas_asignadas.fecha_fin`
nueva (fecha_inicio ya existía); `planes_alimentacion.fecha_inicio`/`fecha_fin` nuevas, las dos.
Todo nullable a propósito -- sin fecha de fin cargada, ese plan no entra nunca en el cálculo de
vencimiento (no se "inventa" un vencimiento para algo al que nunca se le puso fecha, eso hubiera
convertido silenciosamente en "vencidos" a todos los alumnos que ya tenían rutina/dieta asignada
antes de este cambio).

Se puede cargar la fecha de fin en 3 lugares: al asignar una rutina masivamente
(`RutinasPage.jsx`, "Asignar a alumnos" -- misma fecha para todos los tildados, tiene sentido
porque es una sola acción), al asignar/cambiar una rutina individual (`AlumnoPage.jsx`,
`PlanEntrenamiento`), y ahora también **editable sin reasignar** -- un campo + botón "Guardar
fecha" en la propia tarjeta "Rutina asignada", para el caso común de "extenderle una semana más"
sin generar una entrada nueva en el historial por algo que no cambió de verdad. Mismos 2 campos en
`PlanAlimentacion` junto al nombre del plan.

`DashboardPage.jsx` ahora carga también `rutinas_asignadas` (activas) y `planes_alimentacion`, y
calcula "Planes por vencer": mismo criterio de 7 días que ya usa el estado de cuotas
(`estadoDesdeVencimiento`), pero acá sin estado por default -- si no hay `fecha_fin`, ese alumno
simplemente no aparece. Nueva `Card` "Planes por vencer" (mismo patrón que "Atención requerida"),
lista por alumno con el tipo (Rutina / Plan de comida), la fecha, y un badge Vencido (rojo) o Por
vencer (naranja) -- vencidos primero, ordenados por fecha.

Verificado en vivo de punta a punta: se armó un plan de comida completo con el ejemplo real de
Nalux (2 comidas, una con 2 opciones y otra con 1, más 3 observaciones), se vio en pantalla
exactamente como el PDF de referencia, y ambos PDF (rutina real con datos de "Alumno 3", y el plan
de comida recién armado) se inspeccionaron forzando la hoja de impresión a visible -- coinciden
con los dos ejemplos que trajo Nalux. El vencimiento se probó con la rutina real: fecha de fin a
mañana (apareció "Por vencer" en naranja) y fecha en el pasado (apareció "Vencido" en rojo),
confirmado en el panel general en los dos casos. Todo revertido/borrado después (rutina sin
fecha_fin de nuevo, plan de comida de prueba eliminado), confirmado por SQL. `npm run lint` y
`vite build` limpios. **Tampoco subido a git — sigue vigente el acuerdo de que Nalux prueba en
local y avisa cuándo subirlo.**

---

## 02/09/2026 — Biblioteca de alimentos (filtros + carga real) y bloque de mejoras a Asistencia

**Alimentos.** Nalux pidió revisar el módulo ("lo veo muy pelado"). El research no daba ayuda acá:
la app de referencia (`gestiongym.shop`) **no tiene módulo de nutrición** — PLAN.md lo marca como
diferencial propio a defender, no como hueco a copiar — y Ultra Gym tampoco aporta nada del tema.
El hallazgo real fue otro: desde que el plan de comida pasó a texto libre por comida, la
biblioteca quedó **desconectada** del resto (ya no alimenta el armador de dietas), y en la base
había **1 solo alimento con todo en 0**. Se ofreció sacarla del menú; Nalux eligió esa opción,
pero al ver el cambio pidió revertirlo ("la sigo usando igual") — **queda en el menú como estaba**,
y el "Flujo recomendado" del panel vuelve a mencionar alimentos. Revertido por completo.

Sobre eso se sumó lo que sí pidió: **buscador por nombre** y **filtro "con / sin información
nutricional"** (mismo patrón que Ejercicios: chips de categoría + select chico + buscador,
combinados con AND), y se **cargó la biblioteca de verdad**: se completaron los macros del único
alimento que había ("arroz hervido", estaba en 0/0/0/0) y se sumaron 38 más repartidos en las 8
categorías, con calorías y macros por porción — 39 en total. Son datos reales de referencia, no
de prueba: quedan cargados a propósito.

**Asistencia.** Mismo pedido ("fijate cómo lo hicieron otros y mejorémoslo"). Del research salieron
dos cosas ya decididas que **no** se tocan: el registro de acceso por DNI/QR en tótem (requiere
hardware, "es otro producto") y Reservas/turnos con cupo (Fase 3, sin confirmar). Lo que sí estaba
flojo eran 4 cosas, y Nalux las eligió todas:

1. **Navegación entre semanas** (`AsistenciaPage.jsx`): antes la grilla mostraba solo la semana
   actual, sin forma de mirar atrás. Ahora hay flechas ‹ ›, el rango de fechas visible, la leyenda
   "Semana actual" y un botón "Hoy" que aparece solo cuando estás parada en otra semana. Las
   fechas se arman con los campos locales y no con `toISOString()` (que pasa a UTC), para que el
   día sea siempre el que ve el profesor.
2. **Buscador por nombre** en la grilla semanal, con su propio estado vacío.
3. **Alerta "Dejaron de venir"** (`DashboardPage.jsx`): nueva `Card`, mismo patrón que "Planes por
   vencer". Mide contra la última fecha con `presente = true` (ausente y sin registro no cuentan
   como venir). Corte en **10 días**, no 7 como los vencimientos: la asistencia se carga a mano y
   el profesor puede saltearse un día, así que la ventana más ancha evita falsos avisos. Un alumno
   activo que **nunca** tuvo un presente no aparece — no se puede distinguir al que dejó de venir
   del recién dado de alta (ese caso ya lo cubre "alumnos pendientes").
4. **Más estadística por alumno** (`AsistenciaAlumno` en `AlumnoPage.jsx`): **% de asistencia** del
   mes y **racha de faltas seguidas**. El % se calcula sobre los días *registrados* del mes, no
   sobre los días del mes — un día sin registro no es una falta, meterlo en el divisor haría bajar
   el número por días que nadie tocó. La racha cuenta desde el registro más reciente hacia atrás
   sobre todo el historial y corta en el primer presente.

Verificado en vivo: toda la asistencia real es de Alumno 1 y 2 (los dos inactivos) y el único
activo no tenía ninguna, así que se cargaron 3 registros de prueba para Alumno 3 (un presente el
18/08 y ausentes el 31/08 y 01/09). Con eso se confirmó: la grilla navegó hasta la semana del
17/08 y mostró la "P" verde en el martes 18 (+ apareció el botón "Hoy"), el panel mostró "Alumno 3
— Última vez 18/08/2026 · Hace 15 días", y la ficha mostró "0 presentes · 1 ausentes · 0% de
asistencia" en septiembre, "1 presentes · 1 ausentes · 50%" en agosto, y "Viene de 2 faltas
seguidas" en los dos meses. **Los 3 registros de prueba se borraron después**, confirmado por SQL:
quedaron solo las 7 filas reales de Alumno 1 y 2. `npm run lint` limpio, sin errores de consola.
**Nada subido a git** — sigue vigente el acuerdo de que Nalux prueba en local y avisa cuándo subir.

**Vista de mes completo en Asistencia** (mismo día, pedido enseguida después): "a veces el profesor
quiere ver cuántos días fue o faltó en el mes, por cada alumno". Se sumó un toggle **Por semana /
Mes completo** en `AsistenciaPage.jsx`; el mismo click cíclico sirve para las dos vistas y las
flechas ‹ › pasan a moverse de mes en mes.

La vista de mes se hizo primero como una fila de 31 celdas por alumno, y Nalux la corrigió
enseguida: **"al mes hazlo como un calendario, para verlo mejor"**. Quedó entonces **una tarjeta
con almanaque por alumno** (7 columnas, semanas como filas, huecos hasta que cae el día 1 — mismo
patrón que el calendario que ya existía en la ficha del alumno), con **Fue / Faltó / %** en el
encabezado de cada tarjeta. Bastante mejor que la fila larga: entra entero en el celular, sin
scroll horizontal. El % usa el mismo criterio que la ficha del alumno (sobre días registrados, no
sobre días del mes).

Verificado con 5 registros de prueba en Alumno 3 (4 presentes + 1 ausente en septiembre): la
tarjeta mostró "4 fue · 1 faltó (80%)", el día 1 cayó en la columna MA (martes, correcto), los
días 1/2/8/28 en verde y el 3 en rojo, y el mes cerró en 30. Revisado también a 375 px: entra
completo sin scroll lateral. El toggle vuelve a la vista semanal sin romper nada. **Datos de
prueba borrados**, confirmado por SQL (quedaron las 7 filas reales de Alumno 1 y 2). Lint limpio,
sin errores de consola.

**Vista "Pasar lista del día"** (mismo día, tercer pedido sobre Asistencia): "en el día arranca el
día y poner todos los alumnos en una lista y que solo se ponga presente o ausente (...) hasta
cerrar el día, después eso se registra automáticamente en la semana y mes". Se sumó una tercera
vista al toggle, y pasó a ser **la vista por defecto** — pasar lista es la operación diaria;
semana y mes son para mirar hacia atrás.

La lista muestra un alumno por fila con **dos botones explícitos (Presente / Ausente)** en vez del
click cíclico de las grillas — en la operación diaria conviene pedir el estado expresamente y no
que dependa de cuántas veces tocaste. Volver a tocar el botón activo borra la marca (así se
corrige un error). Arriba, contador "X presentes · Y ausentes · Z sin marcar" y el botón **Cerrar
el día**, que marca ausentes de una a **los que no tienen ninguna marca** (a los ya marcados no
los toca), con modal de confirmación que lista por nombre a quiénes va a marcar. Opera sobre todos
los alumnos activos y no sobre el filtro del buscador, para no cerrar el día a medias.

Nalux preguntó después **qué pasa si se olvida de cerrar el día**. No hace falta hacer nada:
**cada botón escribe en la base al instante**, así que todo lo marcado ya queda registrado y se ve
en semana/mes — "cerrar el día" es solo el atajo para el resto. **No se implementó ningún cierre
automático a propósito**: marcar ausente a todo el que no tenga registro en días que nadie tocó
inventaría faltas los domingos, feriados y cualquier día que el gimnasio no abrió, ensuciando el
% de asistencia y la alerta de "dejaron de venir". En vez de eso se aclara en pantalla que cada
marca se guarda sola.

Verificado con 3 alumnos de prueba (ZZZ_test_lista_A/B/C) más Alumno 3: se marcó 1 presente y 1
ausente a mano (contador "1 presentes · 1 ausentes · 2 sin marcar"), se cerró el día (el modal
listó a los 2 pendientes por nombre; quedó "1 presentes · 3 ausentes · 0 sin marcar" y el botón
desapareció), se comprobó en la vista semanal que aparecían la P y las 3 A en el miércoles 02, y
se verificó que volver a tocar un botón activo borra la marca. **Los 3 alumnos de prueba y todas
sus asistencias fueron borrados**, confirmado por SQL (quedaron las 7 filas reales de Alumno 1 y
2). Lint limpio, sin errores de consola.

---

## 03/09/2026 — Bloque de Pagos + separación Configuración / Precios

**Investigación previa.** `PagosPage` era solo lectura (no se podía cobrar desde ahí: el estado
vacío mandaba a la ficha del alumno), sin buscador ni filtros. Aparecieron dos features a medio
construir: `pagos.monto_adeudado` existía en la base y `format.js` ya tenía la lógica de "con
deuda", pero **el formulario nunca escribía ese campo**, así que el estado no se podía activar
nunca; y Avisos segmentaba por "Con deuda"/"Sin cuota" mientras Pagos/Dashboard/ficha solo tenían
3 estados — los dos módulos hablaban idiomas distintos.

**Migración 0013.** `gimnasios.dias_gracia_cuota` (default 0) y `gimnasios.dias_aviso_vencimiento`
(default 7 — deja el comportamiento anterior igual), más `pagos.numero` correlativo **por
gimnasio** con trigger `asignar_numero_comprobante()` (SECURITY DEFINER + `FOR UPDATE` sobre la
fila del gimnasio para serializar, y UNIQUE (gimnasio_id, numero)). Probado: 3 inserts seguidos
dieron 1, 2, 3.

**Decisión de modelado (importante).** La deuda **no se guarda como filas**: el estado "deudor" y
el recargo se CALCULAN desde `periodo_hasta` + la config del gimnasio. Es el mismo criterio que
Nalux aprobó para asistencia ("sino se llenaría la base de datos que serían basura"). Lo mismo con
el comprobante: no se guarda un PDF, cada fila de `pagos` ES el comprobante y se reimprime — un
archivo guardado quedaría desactualizado si se corrige el pago. Y el % de recargo NO se duplicó a
nivel gimnasio: ya existía `configuracion_precios.interes_mora` por plan.

**`format.js`.** Nuevos `estadoCuota(pago, config)` (6 estados: al_dia, proximo, en_gracia,
vencido, con_deuda, sin_cuota) y `deudaEstimada(alumno, estado, planes)` (lo que le tocaría pagar
según su `plan_precio_nombre`, con recargo, devolviendo null si no hay plan/precio para no mostrar
un número inventado). NO se tocaron `estadoDesdeVencimiento()` ni `segmentoNotificacion()`: la
segunda está espejada en SQL y desincronizarlas haría mentir al contador de audiencia de Avisos.

**`PagosPage` reescrita.** Cobrar desde la propia pantalla (botón general + "Cobrar" por fila),
buscador y filtro por estado, métricas de Deuda total y desglose de estados, **"Activar sin
cobrar"** (registra el período con importe 0 y todo como saldo pendiente, así queda "Con deuda" y
no como si hubiera pagado), pago parcial, y formas de pago efectivo / transferencia / tarjeta.
**Comprobante**: numerado, con logo y color del gimnasio, 12pt, cada dato en su fila (nada de
posicionamiento absoluto que se encime). Nalux pidió después **poder verlo en la app**, así que
se muestra en un modal y desde ahí se imprime, en vez de disparar la impresión directo.

**Bugs encontrados y arreglados en el camino** (los dos aparecieron en la consola, no los reportó
Nalux): (1) los valores del comprobante salían **blanco sobre blanco** porque el `color:#000` solo
estaba dentro del `@media print` y fuera de impresión heredaba el tema oscuro — ahora va explícito
en el style inline; (2) en Asistencia, tocar dos veces rápido la misma celda insertaba dos veces
la misma `(alumno_id, fecha)` y reventaba con 23505 sin avisar nada — se agregó un lock por celda
(`enVuelo`) y `cargar()` ahora devuelve la promesa para que el lock se suelte recién cuando el
estado ya se actualizó.

**Separación Configuración / Precios** (pedido de Nalux: "un modulo mas de configuracion y ahi
pasar todo lo que se pueda configurar de la app, y en precios dejar solo configuracion de
precios"). `/configuracion` queda con datos del gimnasio (nombre, logo, color), autorregistro +
QR y vencimiento de cuotas. `/precios` es nueva (`PreciosPage.jsx`) con planes y **períodos
configurables** — migración 0014, tabla `configuracion_periodos` (nombre + días + activo, con RLS
y GRANT), sembrada con Clase suelta / Diario / Semanal / Mensual / Trimestral / Anual. La duración
va en **días** y no en "meses" para que pueda crear cualquier cosa (un pase de 15 días) sin que el
sistema tenga que interpretar nombres. Un período usado por un plan no se puede borrar (avisa
cuántos planes lo usan). Menú: "Precios" (icono Tag) y "Configuración" (Settings).

Verificado en vivo las 3 pantallas, sin errores de consola en carga limpia, `eslint` limpio. Ojo:
`Wallet2` NO existe en esta versión de lucide-react (rompió el HMR de AppLayout hasta cambiarlo
por `Tag`). Los datos de prueba propios se borraron; **el pago de $20.000 de Alumno 3 y su
asistencia del 02/09 son de Nalux probando, no se tocan.** Nada subido a git.

---

## 03/09/2026 (más tarde) — Bloque de Avisos: editar, ver quién leyó, aviso automático de cuota

**Investigación previa.** A diferencia de los módulos anteriores, Avisos ya era el más completo:
segmentación por 6 estados de cuota con contador de audiencia en vivo, acuse de lectura ("X / Y
leyeron"), y archivar/reactivar sin borrar nunca (para no perder el historial de
`notificaciones_leidas`). Lo que faltaba: no se podía editar un aviso ya creado, "X/Y leyeron" no
decía QUIÉN faltaba, y no había forma de avisar automáticamente sin crearlo a mano cada vez —
aunque ya existía `gimnasios.dias_aviso_vencimiento` (migración 0013) sin usarse para disparar
nada, solo para pintar el estado "Próximo a vencer".

**`AvisosPage.jsx`**: `abrirEditar(aviso)` + `editId` reutilizan el mismo modal de "Nuevo aviso"
(ahora "Editar aviso" cuando corresponde) y el mismo `guardar()` (create vs update según
`editId`). "X / Y leyeron" pasó a ser un botón que abre un modal con **dos listas de nombres**
(`detalleLectura()`): quiénes leyeron y quiénes no — calculado recalculando la audiencia HOY
(`segmentoNotificacion`) y restándole los que están en `notificaciones_leidas`, así un alumno que
cambió de segmento desde que se creó el aviso ya no aparece como pendiente de algo que hoy no le
corresponde.

**Migración 0015 — Aviso automático de cuota.** Mismo criterio que Nalux ya aprobó para
asistencia y deuda ("sino se llenaría la base de datos que serían basura"): **no genera filas**.
Una sola plantilla por gimnasio (`gimnasios.aviso_cuota_activo/titulo/mensaje`, con variables
`{nombre} {vence} {plan} {gimnasio}`) que `ver_plan_por_codigo()` arma AL VUELO para cada alumno
según su propio vencimiento — no hay un aviso por alumno por día, y por eso tampoco pasa por
`notificaciones_leidas` (no hay qué "marcar como leído" de algo que no existe como fila; el
recordatorio simplemente desaparece solo cuando el alumno paga). Firma nueva de la RPC (4 columnas
más: `cuota_vence, cuota_estado, cuota_aviso_titulo, cuota_aviso_mensaje`) → DROP + CREATE +
re-GRANT a anon/authenticated (mismo patrón que 0011).

Se muestra solo si: el gimnasio lo tiene prendido, Y el alumno está vencido/con deuda O le vence
dentro de la ventana de `dias_aviso_vencimiento`, Y **no** es "sin_cuota" (a quien nunca pagó no se
lo alarma con esto — no es que se atrasó, nunca empezó). Ojo con una decisión técnica: el corte de
"próximo" adentro de la función quedó con el mismo `<= 7` hardcodeado que ya tenía (no se cambió a
usar `dias_aviso_vencimiento` ahí), porque ese bloque está espejado con `segmentoNotificacion()`
(JS) que cuenta la audiencia de los avisos manuales en la pantalla del profesor — si uno usara la
config y el otro no, el contador "X / Y leyeron" mentiría. La config sí se usa, más abajo, para
decidir si mostrar el recordatorio automático.

**`ConfiguracionPage.jsx`**: tarjeta nueva "Aviso automático de cuota" (checkbox activo + título +
mensaje con pista de las variables disponibles), debajo de "Vencimiento de cuotas".

**`MiPlanPage.jsx`**: banner nuevo con ícono de billetera (`text-warn`/`border-warn`, distinto del
cartel rojo del aviso manual) que muestra `plan.cuota_aviso_titulo/mensaje` cuando vienen no-nulos
— sin botón "Entendido" (no hay nada que reconocer, es un estado que se resuelve pagando).

**Verificado en vivo, de punta a punta:**
- 3 alumnos de prueba SQL (vencido / próximo-a-vencer / sin-cuota) contra `ver_plan_por_codigo()`
  real vía `SET ROLE anon`: el vencido y el próximo mostraron título/mensaje con las 4 variables
  bien reemplazadas; el sin-cuota devolvió `cuota_aviso_titulo: null` — no se le muestra nada.
- La tarjeta de Configuración: tildé el checkbox, guardé, confirmé por SQL que `aviso_cuota_activo`
  quedó `true` en la base real — después lo volví a `false` (default), porque activarlo con el
  mensaje genérico es una decisión de Nalux, no algo para dejar prendido sin que lo haya elegido.
- Alumno 3 (real, cuota vigente hasta 03/10) no mostró ningún banner — cero falsos positivos.
- Avisos: creé un aviso de prueba, "ver quiénes" mostró a Alumno 3 en "Todavía no lo vieron",
  Editar abrió el modal prellenado con los valores existentes, guardé un cambio de título y lo
  confirmé por SQL. **Nota de la sesión (cambié de Opus a Sonnet a mitad de esta verificación):**
  el screenshot del navegador dejó de pintar el modal en un momento (aunque el DOM, los estilos
  computados y el hit-testing confirmaban que SÍ estaba ahí, visible y funcionando) — es un
  artefacto de la herramienta de captura, no un bug de la app; se verificó todo por el DOM real en
  vez de confiar en la imagen.

Todos los datos de prueba (`ZZZ_test_aviso_*`, `ZZZ_test_lista_*` de antes) fueron borrados y
confirmados por SQL. `eslint` limpio en todo el workspace y `vite build` sin errores (2690 módulos).
Nada subido a git.

---

## 03/09/2026 (más tarde) — Campanita de notificaciones para el profesor

Pedido: "que la misma aplicación tenga notificaciones (...) las cuotas vencidas o las que se estén
por vencer o deudas, que lleguen como una notificación arriba, una campanita que avise y redirija
a donde tiene que ir el profesor". Distinto de los avisos de Avisos/MiPlanPage (esos son para el
ALUMNO); esto es para el PROFESOR, dentro de su propia app.

**`NotificacionesCampana.jsx`** (componente nuevo, vive en el header de `AppLayout.jsx`, antes del
toggle de tema): un ícono de campana con badge de cantidad. Al hacer click abre un panel con la
lista de alumnos activos en estado `vencido`, `con_deuda`, `en_gracia` o `proximo` (reusa
`estadoCuota()` de `format.js`, mismo cálculo que ya usa Pagos — sin filas nuevas, se recalcula al
vuelo). A propósito **no incluye "sin_cuota"**: un alumno que nunca pagó no es la misma alerta
urgente, y llenaría la campanita de ruido en un gimnasio con altas recientes. Cada fila es
clickeable y **redirige directo a `/alumnos/:id?tab=pagos`** — la pestaña de Pagos de la ficha del
alumno, ya abierta, sin que el profesor tenga que buscarla. Un botón al pie manda a `/pagos`
entero. Se cierra clickeando afuera (primer uso de ese patrón en la app; no había otro dropdown).

**`AlumnoPage.jsx`**: ahora lee `?tab=` de la URL al montar (`useSearchParams`) para poder abrir
directo en cualquier pestaña válida — hasta ahora la pestaña inicial era siempre "entrenamiento",
sin forma de deep-linkear.

Como `AppLayout` se remonta en cada página (no hay layout raíz persistente), la campanita vuelve a
pedir alumnos+pagos en cada navegación — mismo criterio ya usado en Dashboard/Pagos, liviano con
el volumen real de un gimnasio.

**Bug real encontrado y arreglado en la propia verificación** (no lo vio Nalux): en mobile, el
panel se abría desbordado por el borde izquierdo de la pantalla (`left: -26px` medido a 375px de
ancho) — la campana no queda pegada al borde derecho real (el toggle de tema va después en el
header), así que anclar el panel con `right-0` relativo al botón lo corría de más hacia la
izquierda. Solucionado con el mismo recurso que ya usa el drawer del menú lateral: `fixed` con
margen fijo a los dos bordes en mobile, y recién de `sm:` en adelante vuelve a anclarse como
dropdown normal bajo la campana.

**Verificado en vivo:** 2 alumnos de prueba (uno vencido, uno con deuda parcial) hicieron aparecer
"2" en la campana; el panel los listó ordenados (vencido antes que con_deuda) con su badge de
estado; click en uno navegó a `/alumnos/:id?tab=pagos` y la ficha abrió directo en "Estado de
cuota: Atrasado". Probado el desborde mobile (arreglado, confirmado `left:16` a 375px) y el layout
en desktop (`left:216`, dentro de un viewport de 655px). Alumno 3 (real, al día) no genera ninguna
alerta — cero falsos positivos. Datos de prueba borrados, confirmado por SQL (quedó el único pago
real). `eslint` limpio y `vite build` sin errores (2691 módulos). Nada subido a git.

---

## 03/09/2026 (más tarde) — Investigación de Precios: 3 bugs reales corregidos

Pedido: "vamos a la sección precios, investiga y veamos si nos falta algo o corregir algo". A
diferencia de las investigaciones anteriores (que eran mayormente features faltantes), acá
aparecieron **bugs reales de datos/lógica**, corregidos directamente en vez de preguntados:

**1) Períodos "Mensual"/"Trimestral" sembrados en minúscula.** `create_gimnasio()` (0001) siembra
dos planes de ejemplo con `periodo: 'mensual'/'trimestral'` -- desde la migración 0014 (períodos
configurables), el período de un plan se matchea por NOMBRE EXACTO contra
`configuracion_periodos.nombre` (sembrado en mayúscula: "Mensual", "Trimestral"...). Con la
minúscula, el <select> de "Editar plan" no tenía nada seleccionado. **Migración 0016**: corrige los
2 planes reales de este gimnasio (`UPDATE ... SET periodo = 'Mensual' WHERE periodo = 'mensual'`,
ídem trimestral) y reescribe `create_gimnasio()` (mismo nombre de función, `CREATE OR REPLACE` —
no resetea grants) para sembrar también los 6 períodos base y los 2 planes de ejemplo ya en
mayúscula, para que un gimnasio nuevo arranque bien desde el alta.

**2) `aplicarPlan()` (Pagos) ignoraba `configuracion_periodos`.** Adivinaba la duración comparando
`p.periodo` contra 4 strings fijos ('Trimestral'/'Anual'/'Semanal'/'Diario'); cualquier período que
Nalux creara ella misma (una "Clase suelta", un "Pase de 15 días") caía en el `else` y el sistema
lo trataba como un mes completo, sin avisar -- contradecía el sentido mismo de haber hecho los
períodos configurables. **Corregido** en `PagosPage.jsx`: ahora busca el período por nombre en
`configuracion_periodos` y usa sus días reales (`hasta.setDate(hasta.getDate() + dias)`), con 30
días de piso si el nombre no matchea nada (plan viejo con texto libre). **Mismo bug existía
duplicado** en el viejo formulario de pago de la ficha del alumno -- ver punto 3.

**3) Formulario de pago duplicado y desactualizado en `AlumnoPage.jsx`.** La ficha del alumno
tenía su PROPIO "Registrar pago" (componente `PagosAlumno`), separado del que se armó en Pagos
esta sesión: sin pago parcial, sin "activar sin cobrar", sin comprobante, con el mismo bug de
período de arriba, y calculando el estado de cuota con `estadoDesdeVencimiento()` (3 estados, sin
la config de días de gracia/aviso del gimnasio) en vez de `estadoCuota()` (6 estados, la que ya
usan Pagos/Dashboard/la campanita). Podía mostrar **"Atrasado" en la ficha y "Con deuda" en Pagos
para el mismo alumno al mismo tiempo** -- inconsistencia real, no cosmética. Se sacó la
duplicación: `PagosAlumno` quedó como vista de solo lectura (estado + historial, con
`estadoCuota()`) y el botón "Registrar pago" ahora manda a `/pagos?alumno=<id>` -- `PagosPage`
lee ese query param al montar, abre el modal de cobro con el alumno ya elegido, y lo limpia de la
URL con `replace` para que no se reabra solo si se recarga. Mismo patrón que `?tab=pagos` (bloque
de la campanita). `AlumnoPage.jsx` dejó de pedir `configuracion_precios` (ya no arma el cobro acá)
y ahora pide `dias_gracia_cuota`/`dias_aviso_vencimiento` de `gimnasios` (RLS ya filtra por tenant,
no hace falta pasar el id a mano).

**Verificado en vivo:** "Editar plan" en Mensual mostró el período ya seleccionado (antes vacío).
Se creó un período de prueba de 15 días + un plan apuntándolo -- ninguno de los 4 strings que el
código viejo reconocía -- y "Registrar pago" calculó correctamente 03/09 → 18/09 (15 días exactos;
con el bug viejo hubiera dado 03/10, un mes). El flujo `/alumnos/:id → Registrar pago → /pagos`
abrió el modal con Alumno 3 ya preseleccionado (confirmado por DOM: option "Alumno 3" con su id).
La ficha del alumno mostró "Al día" para su cuota real, coincidiendo ahora con Pagos. Sin errores
de consola. Datos de prueba borrados, confirmado por SQL. `eslint` limpio, `vite build` sin errores
(2691 módulos).

**Pendiente de decisión de Nalux, no bugs sino features faltantes** (se le va a preguntar):
`configuracion_precios.dias_semana` es puramente decorativo (se guarda y se muestra en la tarjeta
del plan, pero nada más en la app lo lee ni lo usa); los métodos de pago de Pagos siguen
hardcodeados (Efectivo/Transferencia/Tarjeta), no configurables desde Precios como si lo tiene la
referencia; y los descuentos son un único % libre por plan, no una lista de descuentos con nombre
para elegir (también algo que tiene la referencia). Nada de esto se tocó todavía.

Nada subido a git.

---

## 03/09/2026 (más tarde) — Descuentos con nombre

De las 3 opciones no-bug que quedaron pendientes en la investigación de Precios, Nalux eligió
"Descuentos con nombre". **Migración 0017**: tabla `configuracion_descuentos` (nombre, porcentaje,
activo), mismo patrón que `configuracion_periodos` (RLS + GRANT a authenticated). A propósito NO
queda referenciada por ningún plan (a diferencia de `periodo`, que si es un campo de
`configuracion_precios`): un descuento con nombre se elige AL COBRAR, no al armar el plan, así que
borrarlo nunca deja nada huérfano y no hace falta el chequeo de "en uso" que sí tiene
`borrarPeriodo()`.

**`PreciosPage.jsx`**: tarjeta "Descuentos" nueva, mismo ABM que "Períodos" (crear/editar/eliminar,
sin período de gracia porque no aplica acá).

**`PagosPage.jsx`**: select "Aplicar descuento" en el modal de cobro (solo aparece si hay al menos
uno activo cargado) que pisa el campo numérico "Descuento (%)" ya existente al elegir uno — el
campo sigue editable a mano después, para un descuento puntual que no está en la lista.

Verificado en vivo: creado un descuento de prueba (10%) desde Precios, apareció en el select de
Pagos con el formato "ZZZ_test_descuento (-10%)", y al elegirlo el campo numérico pasó a "10"
correctamente. Sin errores de consola. Datos de prueba borrados, confirmado por SQL. `eslint`
limpio, `vite build` sin errores (2691 módulos).

Con esto queda cerrado el bloque de Precios (3 bugs corregidos + esta feature). Nada subido a git.

---

## 03/09/2026 (más tarde) — Configuración: color, logo+nombre y comprobante

**Bug real: el color del gimnasio no pintaba la app.** Nalux: "recién cambié a un color morado
pero la app no cambió de color". Causa: `--primary`/`--accent`/`--ring` están hardcodeados al rojo
de Kairox en `index.css`, y NADA en el código los sobreescribía con
`gimnasios.color_principal` -- el picker de Configuración guardaba el valor perfecto, pero solo se
leía suelto en el PDF del comprobante y en los PDF de MiPlanPage, nunca para pintar la interfaz en
vivo. Nuevo `lib/colorTema.js`: `aplicarColorGimnasio(hex)` convierte HEX → HSL (mismo formato "H
S% L%" que ya usan las custom properties, sin tocar ningún className) e inyecta
`--primary/--accent/--ring` + sus `-foreground` (blanco o casi-negro según luminancia relativa
WCAG, para que un color pastel no deje texto blanco invisible) directo en `<html>` vía JS. Se llama
desde dos lugares: `AuthContext.jsx` (toda la app del profesor, dispara solo apenas cambia
`profile.gimnasios.color_principal` -- se re-ejecuta solo con `refreshProfile()`, que
`guardarDatosGimnasio()` ya llamaba) y `MiPlanPage.jsx` (pantalla pública del alumno, con
`plan.gimnasio_color_principal` que ya traía la RPC). **A propósito NO se tocó `--destructive`**:
los botones "Eliminar" quedan siempre rojos aunque el gimnasio elija otro color -- más seguro que
un peligro del mismo tono que la marca. Verificado con el morado real que ya tenía cargado
(`#7b00e0`): `--primary` computado dio `273 100% 44%` (matemáticamente correcto) y se vio en
botones, íconos y acentos en Panel/Configuración, desktop y mobile.

**Bug real: el nombre del gimnasio desaparecía si había logo.** `GimnasioMark` (AppLayout.jsx)
devolvía SOLO el `<img>` en cuanto había `logo_url` -- el nombre nunca se mostraba al lado, solo en
el caso sin-logo (ahí sí, grande y en mayúscula, porque tenía que sostener la marca solo). Nalux:
"el nombre del gym, que se vea al lado del logo (...) chico y sutil, pero que la firma de kairox ia
no se pierda". Ahora logo (o el ícono de respaldo) y nombre van siempre juntos; con logo real el
texto es chico/gris/sin mayúsculas (subordinado al logo), sin logo sigue siendo grande/en mayúscula
(sostiene la marca solo). La firma de Kairox (`KairoxFooterMark`, en el pie del sidebar/drawer) no
se tocó -- sigue ahí.

**Código de invitación: aclarado, no removido.** Nalux dijo no verle sentido "si no hay login para
los alumnos" -- posible confusión con el código de ACCESO individual del alumno (QR sin login,
Decisión 20). Se le explicó la diferencia: el código de invitación es para AUTORREGISTRO (un
alumno nuevo se anota solo, queda "pendiente" hasta que el profesor aprueba) -- de hecho ya estaba
en uso: el Dashboard mostraba "1 alumno pendiente" real. Sigue sin resolverse si lo quiere de todos
modos ahora que entiende qué hace -- no se tocó nada de esta sección.

**Investigación "qué falta en Configuración"** (comparando contra PLAN.md 1.16, Personalización de
marca): la mayoría ya estaba hecha o superada (comprobante numerado, aviso de cuota con 4
variables vs. las 4 de la referencia). 3 gaps reales encontrados, presentados con AskUserQuestion:
- **Bloquear el plan si la cuota está vencida** -- **Nalux eligió NO, dejarlo como está** (el
  alumno siempre puede ver su plan, deba o no).
- **Cambiar la propia contraseña desde Configuración** -- **Nalux eligió NO sumarlo** (solo existe
  hoy el flujo de "olvidé mi contraseña" por mail).
- **Texto de pie del comprobante editable** -- **Nalux SÍ lo quiso.** Implementado: migración 0018
  agrega `gimnasios.comprobante_texto_pie` (default = el texto fijo que ya había, para no
  cambiarle nada a nadie que no toque la configuración), tarjeta nueva "Comprobante" en
  ConfiguracionPage.jsx (Textarea, tope 255 caracteres con contador), y `PagosPage.jsx` ahora lee
  `gimnasio.comprobante_texto_pie` en vez del string hardcodeado (el párrafo del pie directamente
  no se renderiza si el campo queda vacío).

Verificado en vivo: color morado real reflejado correctamente app-wide; logo+nombre juntos y
chicos, confirmado por captura en desktop y mobile; texto de comprobante cambiado a un valor de
prueba, confirmado que aparece en el PDF/vista del comprobante, y restaurado al texto original
después. Sin errores de consola en ningún paso. `eslint` limpio, `vite build` sin errores (2692
módulos). Nada subido a git.

---

## 03/09/2026 (más tarde) — Código de invitación, sacado

Después de aclarar qué hacía (autorregistro, no login del alumno), Nalux fue tajante: "code de
invitación, sacalo". Se sacó de `ConfiguracionPage.jsx`: la tarjeta completa (código, checkbox
"Autorregistro activo", QR, botón "Regenerar código"), las funciones `copiarCodigo`/
`toggleAutorregistro`/`regenerarCodigo`, el `useEffect` que generaba el QR, los 5 estados que solo
servían para esto (`codigoError`/`copiado`/`autorregistroSaving`/`regenerando`/`qrDataUrl`), el
import de `qrcode`, y las menciones a "autorregistro" en el subtítulo/meta de la página.

**Alcance de la decisión, importante dejarlo claro:** se sacó de la UI y se **apagó
`autorregistro_activo` en la base para este gimnasio** (chequeado server-side de verdad, no
decorativo -- `join_gimnasio_por_codigo()` y `listar_planes_para_codigo()` exigen
`autorregistro_activo = true`, así que un link/QR viejo que alguien tuviera guardado ya no
funciona). **NO se borró el esquema** (columnas `codigo_invitacion`/`autorregistro_activo`, las
RPC, `UnirsePage.jsx`, la ruta `/unirse/:codigo`) -- queda como capacidad muerta pero reutilizable,
no como decisión de producto para siempre. Motivo: esto es un SaaS pensado para venderse a otros
gimnasios (ver la nota de negocio de "Facturación de Kairox a los gimnasios clientes" en este mismo
CONTEXT.md); sacar el autorregistro de SU gimnasio es una preferencia operativa de Nalux, no
necesariamente algo que un futuro cliente distinto también querría sacado del producto entero. Si
en algún momento se decide sacarlo también del código/esquema para siempre, es un paso aparte.

`eslint` limpio, `vite build` sin errores (2692 módulos). **No pude reverificar visualmente en el
navegador** -- la sesión se cerró sola mientras tanto y no hay re-login posible sin escribir la
contraseña de Nalux (regla dura, nunca se hace). Pendiente que ella lo confirme en local. Nada
subido a git.

---

## 03/09/2026 (más tarde) — Rediseño premium de Login/Registro/Recuperar contraseña

Pedido: "vamos con el loguin, ya que no tiene color definido (...) yo pensaba en un gris ocuro con
ondas de grises claron (...) dorados (...) profesional y premium (...) que impacte, no tan cargado
ni tan pelado. llama al agente fronend para que te ayude". Se delegó al subagente
`frontend-architect` con un brief detallado (contexto de negocio, cita textual del pedido,
restricciones técnicas). **Dos intentos fallaron por sobrecarga transitoria del servidor en Opus
(529 Overloaded)** antes de tocar ningún archivo -- el tercer intento, con Sonnet, se completó
limpio.

**Hallazgo del propio agente, correcto:** `LoginPage.jsx`, `OnboardingPage.jsx` y
`ResetPasswordPage.jsx` compartían EXACTAMENTE el mismo shell visual (mismos blobs `bg-primary/20`,
misma barra, misma card) -- rediseñar solo el login hubiera dejado un salto visual roto al pasar a
Registro o a "Olvidé mi contraseña". Se extrajo a un componente nuevo compartido,
`src/components/AuthBackdrop.jsx`, aplicado en las tres.

**Paleta (fija, no depende del theme claro/oscuro):** base `#110f0d` con gradiente sutil a
`#0e0c0a`/`#17140f`. "Ondas": 2 radiales de gris cálido con blur (`#433c30`, `#242019`) + 1 halo
dorado casi imperceptible (`#c9a86a` al 8%) detrás de la card, con un drift lentísimo (22-32s) vía
`@keyframes` CSS puro (nada de JS/librerías nuevas), respetando `prefers-reduced-motion`. Dorado de
acento: `#d8b876` (links/kickers) y gradiente `#e3c98f → #c9a86a` (botones primarios, texto encima
`#1c1509` -- ~8:1 de contraste, verificado). Línea superior: antes una barra sólida roja, ahora un
hairline dorado con degradé + resplandor radial detrás.

**Decisión de diseño explícita:** esta identidad es fija (Kairox, pre-login), NO se adapta al modo
claro/oscuro del sistema -- se sacó el `<ThemeToggle />` de las 3 pantallas. Truco técnico para no
tocar `ui-kit.jsx`: la raíz de `AuthBackdrop` lleva `className="dark"`, forzando que
`Input`/`Btn`/`Field`/`ErrorBox` (que leen `--background`/`--card`/`--border` de `index.css`)
resuelvan siempre a sus valores oscuros sin importar qué theme haya quedado guardado en la sesión
del navegador. `index.css` y `colorTema.js` (theming por-gimnasio de post-login) NO se tocaron. El
`<Logo />` compartido (ícono + "Kairox" en rojo, usado en 6 lugares de la app) se dejó intacto a
propósito -- es la firma de marca, no se toca.

**Repasado y corregido después de la entrega del agente** (fuera del alcance que se le dio, pero
necesario para consistencia real): el botón "Enviar enlace" del `PasswordRecoveryModal` (componente
aparte, no listado en el brief) seguía en rojo -- se le aplicó el mismo gradiente dorado. Y en
Onboarding, el selector nativo `<input type="file">` del logo (`file:bg-primary`) también quedaba
rojo -- corregido al mismo gradiente. Confirmado con `grep` que no queda ningún `bg-primary`/
`text-primary` crudo en las 3 páginas.

**Verificado en vivo:** Login (modo ingreso y modo registro), modal de recuperar contraseña
(dorado consistente después del fix), ResetPasswordPage en su estado "enlace inválido" (no se pudo
probar el estado de éxito real sin un token de recuperación válido), mobile a 375px sin desborde
horizontal (`scrollWidth === clientWidth`), sin errores de consola en ningún paso. **Onboarding NO
se pudo probar en vivo** (ruta protegida, requiere sesión, y la sesión del navegador seguía cerrada
de antes -- no hay re-login sin escribir la contraseña de Nalux, regla dura) -- se revisó a fondo
por código en cambio (mismo patrón que las otras dos, sin ningún `bg-primary` crudo salvo el que se
corrigió). `eslint` limpio, `vite build` sin errores (2693 módulos).

**Fuera de alcance, mencionado por el propio agente:** `UnirsePage.jsx` (pantalla donde un alumno
se une a un gimnasio por QR) sigue con el shell viejo -- no se tocó porque no estaba en el pedido
(era específicamente sobre login/registro/recuperar), pero es candidata natural para el mismo
`AuthBackdrop` si en algún momento se quiere la misma identidad ahí.

Archivos: nuevo `src/components/AuthBackdrop.jsx`; modificados
`LoginPage.jsx`/`OnboardingPage.jsx`/`ResetPasswordPage.jsx`/`PasswordRecoveryModal.jsx`. Nada
subido a git.

---

## 03/09/2026 (más tarde) — Wordmark "Kairox": de rojo a gris azulado tornasolado

Pedido, apenas vista la primera versión del rediseño premium: "a lo que esta en rojo cambialo por
un gris que se note, puedes hacerlo tornasolado, o algo, tirando a un azulado". Lo único que había
quedado en rojo en las 3 pantallas rediseñadas era el propio wordmark de Kairox (ícono +
"Kairox" en `text-primary`, componente `Logo` en `AppLayout.jsx`) -- a propósito no se había
tocado en la vuelta anterior porque es la firma de marca, no parte del fondo. Confirmado por grep
que `<Logo>` (distinto de `<GimnasioMark>`, que sí es por-gimnasio) HOY solo se usa en esas mismas 3
pantallas (Login/Onboarding/ResetPassword) -- el comentario viejo del archivo que decía "6 lugares"
está desactualizado, quedó de antes de que existiera `GimnasioMark`. Cambiarlo ahí no afecta nada
del resto de la app.

**`AppLayout.jsx`**: el badge del ícono (borde + fondo) y el ícono de mancuerna pasaron de
`border-primary`/`bg-primary`/`text-primary` (rojo) a un gris azulado fijo (`#8f9db2`/`#aebbcf`).
El texto "Kairox" pasó de `text-primary` a una clase nueva, `.kx-shimmer`.

**`index.css`**: nueva clase `.kx-shimmer` (en `@layer utilities`, junto a `.text-ok`/`.text-warn`
que ya vivían ahí) -- gradiente lineal de grises azulados con un pico casi blanco en el medio,
recortado al texto (`background-clip: text` + `color: transparent`) y animado vía
`background-position` en un loop de 6s (`ease-in-out infinite`) para el efecto "tornasolado": el
brillo recorre el texto lento, sin nada brusco. Respeta `prefers-reduced-motion`. Es un color FIJO,
sin relación con `--primary`/`colorTema.js` (eso sigue siendo el theming por-gimnasio post-login,
sin tocar).

Verificado en vivo: el badge+ícono ya no son rojos, "Kairox" muestra el degradé azulado-gris
correcto (confirmado por JS: `background-clip: text`, `color: transparent`, animación
`kx-shimmer-move` de 6s activa), y se ve igual en Login y en ResetPasswordPage (mismo componente
compartido, no hace falta tocar cada página). `eslint` limpio, `vite build` sin errores (2693
módulos). Nada subido a git.

---

## 03/09/2026 (más tarde) — Biblioteca de ejercicios: importación gratuita (90 ejercicios)

Pedido: "arma la importación de ejercicios primero" (tras la investigación de licencias). Nuevo
`lib/biblioteca_ejercicios_base.js` -- 90 ejercicios curados a mano, en ESPAÑOL, con foto real de
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) (licencia Unlicense, dominio
público, cero restricciones). El dataset completo tiene 876 en inglés con muchísima repetición sin
traducir (23 variantes solo de "deadlift") -- Nalux preguntó por qué no los 800+, se le explicó y
eligió "más en español, de a poco" en vez de importar todo en inglés de una. Se armaron 2 tandas
(50 + 40) traducidas y clasificadas a mano contra `GRUPOS`/`CLASIFICACIONES` (`clasificacion` queda
vacía a propósito en ejercicios de aislamiento -- ninguna de las 10 categorías describe bien un
curl o una extensión, forzarlo mentiría más de lo que ayuda).

**`EjerciciosPage.jsx`**: botón nuevo "Importar biblioteca base" (junto a "Nuevo ejercicio"). Se
salta por nombre (case-insensitive) lo que ya esté cargado -- se puede tocar más de una vez sin
duplicar. Es código, no datos: corre para CUALQUIER gimnasio que lo toque (el suyo o uno nuevo que
se registre), pero **no es automático** -- Nalux lo pidió explícitamente así por ahora: "esta app
va a ser con planes de suscripción y voy a limitar algunas cosas, pero eso lo vemos cuando ya esté
terminada la app". No se tocó `create_gimnasio()` para sembrar esto solo -- decisión de ella,
pendiente para más adelante.

**Bug real encontrado y arreglado en el camino** (ella lo pidió apenas vio el primer resultado,
"que halla una vuelta atras para volver a la app"): `tipoDePreview()` en `EjerciciosPage.jsx` solo
ofrecía ver la demostración adentro de un modal si el archivo estaba en NUESTRO bucket de Storage
-- cualquier URL externa (aunque fuera una imagen suelta, como las de este import) caía al viejo
comportamiento de abrir en pestaña nueva, exactamente el problema que Nalux ya había reportado
antes con videos externos. Se separó el criterio: si la URL termina en una extensión de imagen
conocida (jpg/png/webp), se muestra en el modal sin importar el host -- solo el VIDEO externo
sigue exigiendo ser archivo propio (ahí sí hace falta confiar en que es el archivo posta y no una
página con reproductor tipo YouTube).

**Aplicado directo en la base real** (mismo motivo que con Alimentos/Períodos: no tiene sentido
dejarlo solo como botón sin probarlo, y ella no puede tocar el botón porque la sesión estaba
cerrada) -- 90 filas nuevas para su gimnasio real, sin duplicar sus 4 ejercicios propios
(Peso Muerto, Press Frances, Búlgara, Sentadilla Frontal se dejaron intactos). Nalux preguntó
explícitamente si esto consumía su plan gratis de Supabase -- aclarado que NO: las imágenes viven
en GitHub, no se subió nada a Storage, la tabla completa de ejercicios pesa 104 kB (el free tier da
500 MB). También preguntó si esto aplicaba a todos los gimnasios automáticamente -- aclarado que
los DATOS son solo de su gimnasio (aislados por RLS), lo único global es el botón/código.

Verificado en vivo: "Ver demostración" en un ejercicio importado abrió la foto real adentro del
modal (antes hubiera abierto pestaña nueva). `eslint` limpio, `vite build` sin errores (2694
módulos). Nada subido a git.
---

## 04/09/2026 — Bloque grande: biblioteca de alimentación, rutinas congeladas, login del alumno y offline del alumno

> ⚠️ Entrada reconstruida el 07/09/2026 a partir de las migraciones y del código: ese día se
> trabajó mucho y no se fue anotando acá. Es el motivo por el que Nalux pidió, el 07/09, que
> CONTEXT.md se actualice **en la misma tanda de cada cambio** — ver el cierre de esta entrada.

Migraciones **0022 a 0028**. Lo que quedó:

- **0022** — `ver_plan_por_codigo()` devuelve también `fecha_inicio`/`fecha_fin` del plan de
  alimentación, para que el PDF del alumno pueda mostrar el rango igual que el de rutina.
- **0023** — `progreso` suma `pierna` y `cadera`. Se investigó qué miden los gimnasios: el set
  estándar es cintura, cadera, pecho, brazo y muslo. Nalux pidió pierna; cadera se sumó de una
  vez por ser el complemento de cintura (relación cintura-cadera) en toda la bibliografía.
- **0024** — `ingresos_por_mes()` (gráfico del panel) y archivado manual de pagos. El archivado
  es **siempre** una acción explícita del profesor, nunca automática: cada fila de `pagos` es
  también el comprobante numerado, borrarla pierde la posibilidad de reimprimirlo.
- **0025** — biblioteca de planes de alimentación reutilizables, el equivalente de Rutinas para
  el lado de nutrición.
- **0026** — la rutina asignada guarda su **propia copia** del contenido ("congelada"): editar
  después la plantilla en la biblioteca ya no le cambia la rutina a nadie sin avisar. Mismo
  criterio que ya usaba `planes_alimentacion`.
- **0027** — se sacó un fallback de `ver_plan_por_codigo()` que rompía esa garantía de "copia
  congelada" en el caso borde de una rutina asignada con 0 ejercicios.
- **0028** — **login del alumno con usuario y contraseña**, que reemplaza al QR. Lo crea el
  profesor desde la ficha del alumno (`crear_acceso_alumno`), la contraseña se hashea con
  `crypt()`/`gen_salt('bf')` y `iniciar_sesion_alumno()` devuelve el `codigo_acceso` que la app
  guarda en el celular. Mensaje de error genérico a propósito (no revela si el usuario existe) y
  límite de intentos por ventana de tiempo.

Además, sin migración: **`public/sw.js`**, un service worker escrito a mano (a propósito, sin
plugin de build: `vite.config.js` ya tiene mucha lógica propia de la plataforma de despliegue y
no conviene tocarlo) para que el alumno pueda seguir viendo su rutina y su plan **sin señal ni
wifi**, que es la situación real en muchos gimnasios.

---

## 07/09/2026 — El traductor de Chrome rompía la app, panel offline del profesor, PDF descargable y un montón de correcciones

Día largo. Lo más importante primero.

### El hallazgo grande: el traductor automático de Chrome rompía la app

Nalux reportó que en el celular la app **se ponía en negro** al entrar o al cambiar de módulo, y
que había que recargar a mano. También que aparecían palabras rarísimas: **"viernes" salía como
"rivalizar"**, **"planes" como "aviones"** y la **"P" de Presente como "PAG"**.

Esas tres palabras fueron la pista. Ninguna estaba en el código: eran **traducciones**. "Vie" es
un verbo en inglés (*to vie* = rivalizar), *planes* en inglés son aviones, y la "P" la leyó como
abreviatura de *Page* → *Pág*.

**Causa raíz:** `apps/web/index.html` venía de la plantilla de Hostinger Horizons con
`<html lang="en">`, con toda la app escrita en español. Chrome daba la página por inglesa y le
pasaba el traductor automático por encima. Y al traducir, **Chrome reemplaza los nodos de texto
del DOM**; React, que sigue apuntando a los nodos originales, explota al intentar actualizarlos
(el clásico `removeChild ... is not a child of this node`). Eso era la pantalla negra, los
crashes al entrar a Alumnos, y también **los contadores en 0** de las bibliotecas: la página se
rompía antes de terminar de cargar los datos, y quedaba el valor inicial.

**Arreglo:** `lang="es"` + `translate="no"` + `<meta name="google" content="notranslate">`.

⚠️ **Gotcha para el futuro:** si alguna vez se agrega otro HTML de entrada, tiene que declarar el
idioma real. Un `lang` equivocado no es un detalle de accesibilidad acá: rompe React en producción
de una forma que no aparece nunca en desarrollo (el traductor no se activa en localhost).

### Red de contención: error boundary

No había **ningún** error boundary en toda la app, así que cualquier excepción al renderizar
desmontaba todo React y dejaba `<div id="root">` vacío — que en modo oscuro se ve negro y mudo.
Nuevo `components/ErrorBoundary.jsx` envolviendo la app: ahora sale un mensaje con botón de
recargar. No evita el error, evita que el usuario se quede mirando una pantalla negra sin saber
qué pasó.

### Panel del profesor sin conexión (migraciones 0029 y 0030)

Pedido de Nalux: que si el gimnasio se queda sin wifi unas horas, el panel siga usable y se
sincronice solo al volver. Se implementó en `lib/offline.js`:

- **Ver datos ya cargados**: `listAll()` guarda en `localStorage` cada resultado exitoso y, si
  la próxima falla **por red** (no por permisos — eso se re-lanza tal cual), devuelve lo último
  guardado.
- **Marcar asistencia y registrar pagos sin conexión**: se encolan y se mandan solos con el
  evento `online`. Los pagos se sincronizan **de a uno y en orden**, porque el número de
  comprobante se asigna recién al insertarse de verdad.
- Cartel global de "sin conexión / sincronizando N pendientes" y aviso al cerrar sesión si queda
  algo sin mandar (cerrar sesión limpia la cola).

⚠️ **Gotcha real, costó encontrarlo:** la 0029 creó el índice de `pagos.client_id` como índice
único **parcial** (`WHERE client_id IS NOT NULL`). PostgREST arma el upsert como
`ON CONFLICT (client_id)` sin el `WHERE`, y Postgres no lo reconoce como el mismo índice: error
`42P10`. Resultado: **todo pago cargado sin conexión fallaba en silencio al sincronizar** (se
descartaba de la cola sin insertarse). La **0030** lo reemplaza por un `UNIQUE` normal — no hace
falta que sea parcial, porque en Postgres un UNIQUE ya permite cualquier cantidad de `NULL`.

### Service worker: la otra causa de "hay que recargar"

Cuando se sube una versión nueva, Vercel deja de servir los JS/CSS de la anterior. Si el service
worker devolvía un HTML viejo guardado, ese HTML pedía archivos que ya no existen (404 real, no
error de red) y la app no arrancaba. Tres arreglos: cache renombrada a `kairox-v2` (así el celular
descarta la vieja entera), fallback al cache cuando la red responde con error y no sólo cuando
falla la conexión, y **recarga automática una sola vez** cuando el navegador avisa que un service
worker nuevo tomó control de la pestaña (`controllerchange`).

### PDF: páginas en blanco y descarga directa

- **Páginas en blanco**: el CSS de impresión ocultaba la app con `visibility: hidden`, que la hace
  invisible **pero le deja toda su altura** — el navegador seguía paginando esas pantallas vacías
  detrás del PDF. Ahora la hoja se monta **fuera de `#root`** (portal al `body`) y al imprimir se
  saca la app con `display: none`. Medido después del cambio: 1 página, 0 sobrante.
- **Descarga directa** (pedido de Nalux: "que se baje en PDF más práctico"): antes había que
  pasar por el diálogo de imprimir y elegir "Guardar como PDF". Ahora `lib/descargarPdf.js`
  fotografía la misma hoja y baja el archivo con nombre propio ("Rutina - Alumno 4.pdf"). Alcanza
  a las cuatro pantallas que generan PDF más el comprobante de pago.
  - `jspdf` y `html2canvas` se cargan con **`import()` dinámico**: entre las dos pesan ~587 KB y
    son para una acción puntual, así que Vite las deja en archivos aparte. Verificado en el build
    real: al abrir la app no se descarga ninguna de las dos; el bundle principal sólo creció 12 KB.
  - El comprobante se genera desde una **copia aparte** (clase `cp-hoja-pdf`), no desde la que se
    ve en el modal, para no moverla en pantalla mientras se la fotografía. Esa copia está excluida
    del `@media print` para que en papel no salga el comprobante dos veces.

⚠️ **Gotcha:** el código usaba `requestAnimationFrame` para esperar a que React montara la hoja.
**rAF no corre si la pestaña está en segundo plano**, así que si el usuario cambiaba de pestaña
justo al tocar el botón, se quedaba en "Generando..." para siempre. Reemplazado por una espera
que consulta el DOM.

### Cobro más simple (migración 0032)

Nalux: *"muchos comprobantes sin cobrar, está mal eso, el comprobante saldría cuando el alumno ya
paga"*. Tenía razón: toda fila de `pagos` se llevaba número de comprobante, incluidas las
activaciones sin cobrar (monto 0), y la lista se llenaba de comprobantes por $ 0.

Ahora el número **se asigna sólo si entró plata** (`monto > 0`). Una activación sin cobrar sigue
siendo una fila (cubre el período y deja la deuda anotada) pero sin número: no es un comprobante,
porque no hubo nada que comprobar. Los pagos parciales sí llevan número — hubo un cobro real.
En pantalla, esas activaciones se muestran en su propia sección ("Activados sin cobrar") con
botón para cobrar, y en el formulario la opción pasó a ser secundaria ("No está pagando ahora").

Los comprobantes que ya se habían numerado antes de esta migración se filtran por monto en la
UI, así que salen del listado **sin tocar ningún dato ya cargado**. Como contrapartida, esos
números quedan ocupados y la numeración visible salta (0001 → 0004).

### Asistencia (migración 0031)

- **Presente en verde y ausente en rojo siempre**, sin importar el color que el gimnasio haya
  configurado. Antes el ausente usaba el color de marca, que en un gimnasio rosa no se leía como
  "faltó".
- **Días que abre el gimnasio**, configurables (`gimnasios.dias_abiertos`, default lunes a
  sábado). Los días cerrados salen en gris y no se pueden marcar. Se generalizó a los 7 días en
  vez de un booleano sólo para el domingo: hay gimnasios que cierran otros días.
- "Cuántas veces **vino** o faltó" en vez de "fue".

### Correcciones de responsive (celular)

- **Armado de rutina y vista del alumno**: series / reps / peso / descanso quedaban uno debajo del
  otro (cuatro renglones por ejercicio). Ahora entran los cuatro en una línea, con cajas más
  chicas.
- **Biblioteca de alimentos**: la tabla quedaba cortada y encima el contenedor tenía
  `overflow-hidden`, así que tampoco se podía correr al costado. En pantalla chica pasa a ser una
  tarjeta por alimento; la tabla queda de `sm` para arriba.
- **Barra de arriba**: botones como "Nuevo alumno" se partían en dos renglones y le comían el
  ancho al nombre del gimnasio, que quedaba en "Mi G...". Ahora el botón de acción baja a su
  propia fila en el celular y el nombre se ve completo.

### Otras correcciones del día

- **Contador de la biblioteca de alimentos** (era la única de las tres sin contador) y el
  subtítulo de ejercicios pasa a **contar los que realmente hay** en vez de decir "500" escrito a
  mano (Nalux: *"no mintamos por favor"*; el número resultó ser cierto, pero ahora se calcula).
- **Botón "Ver"** en las tarjetas de rutinas y de planes de alimentación, para abrirlos en modo
  lectura sin entrar a editarlos.
- **Alta de alumno**: el plan pasa a ser obligatorio y muestra el precio al lado. Si todavía no
  hay planes cargados, avisa y manda a Precios.
- **Módulo "Rutinas" → "Rutinas de ejercicios"**, en el menú y en el título de la pantalla.
- **Seguimiento físico**: el formulario ya tenía las siete medidas desde la 0023, pero guardaba
  `Number(campo || 0)` — si el profesor sólo pesaba al alumno (lo normal: se pesa seguido, se mide
  de vez en cuando), las otras cinco quedaban guardadas como **0 cm**. Ahora un campo vacío va
  como NULL, el historial lista sólo las medidas realmente tomadas, y el gráfico de peso saltea
  los registros sin peso. El 0 se interpreta como "no medido" en toda la pantalla, así que los
  registros que ya habían quedado en 0 también se ven bien sin tocarles el dato.

### Más del mismo día: sidebar cortado en desktop y limpieza de lenguaje

Nalux reportó que en la **computadora**, con la ventana poco alta, no se veían ni el botón
"Cerrar sesión" ni la marca "Gestión GYM Kairox IA" — sí se veían en el celular.

**Causa:** todo el sidebar (`AppLayout.jsx`) era un solo bloque de alto fijo (`h-screen`) con
`justify-between` y sin ningún `overflow`. El menú de 11 ítems más el pie (correo, botón, marca)
podían sumar más que el alto disponible; lo que no entraba se cortaba por debajo del borde sin
ninguna forma de llegar ahí — la página no ayuda porque el aside es `sticky` y queda fijo en la
ventana, no tiene su propio scroll. Reproducido a 1280×600 (común en laptops de resolución baja
o ventana sin maximizar); a 1280×720 no pasaba, por eso no era obvio.

**Arreglo:** el aside pasa a tener tres secciones en vez de un bloque `justify-between`: logo
arriba (`shrink-0`, fijo), menú en el medio (`min-h-0 flex-1 overflow-y-auto`, scrollea sólo él
si hace falta) y pie abajo (`shrink-0`, siempre fijo y visible). Verificado a 1280×600 antes de
subirlo: el botón queda dentro de la ventana (antes se cortaba, quedaba fuera del `viewport`).

**Lenguaje poco profesional**, pedido explícito de Nalux con un ejemplo puntual ("al toque" en
Asistencia semanal). Revisados todos los textos visibles de la app; se encontraron y corrigieron:

- Asistencia (vista de día): "se ve **al toque**" → "se refleja de inmediato"; "marcar **de una**
  a los que faltaron" → "marcar a todos los que faltaron **de una vez**".
- Pagos: "**Pisa** el % de acá abajo" (jerga técnica) → "Completa el porcentaje de abajo
  automáticamente"; "**Le tocaría** \{monto\}" → "Deuda estimada: \{monto\}".
- Dos restos de **voseo** que se habían escapado de la limpieza de idioma de días anteriores
  (`PlanesAlimentacionPage.jsx`: "Agregá" → "Agregar"; `ResetPasswordPage.jsx`: "Pedí" → "Pedir").
- De paso, dos textos que habían quedado **desactualizados** desde la migración 0028 (login del
  alumno): el subtítulo de Avisos y la meta description de `/mi-plan/:codigo` seguían diciendo
  "sin necesidad de que el alumno tenga sesión" / "sin necesidad de usuario ni contraseña", cuando
  desde el 04/09 el alumno sí inicia sesión con usuario y contraseña.

### Más del mismo día: primera pasada de rediseño (menú animado + bug de colores de alerta)

Nalux pidió empezar a mejorar la estética ("que no quede tan lenta", diseño neutro para
cualquier persona, un efecto de "rayo dorado" en el menú al desplegarse). Antes de tocar código
se lanzó al agente `frontend-architect` a auditar el sistema de diseño actual y proponer opciones
— la auditoría completa (paleta real, qué pesa de más, riesgos de neutralidad de género) quedó
resumida en la conversación con Nalux, no repetida acá en detalle. Dos hallazgos de esa auditoría
se implementaron esta misma tanda:

**1. Corrección de expectativa importante:** dentro del panel logueado **no había dorado en
ningún lado** — el dorado (`#c9a86a`/`#d8b876`) está confinado a las 3 pantallas antes del login
(`AuthBackdrop.jsx`). El color "de fábrica" real, antes de que un gimnasio configure el suyo, es
el rojo de `--primary` en `index.css`. Relevante porque cambia qué significa "agregar dorado" acá
y también conecta con el pedido de neutralidad (ese rojo de fábrica es agresivo/"gym de fierros").

**2. Menú del celular con entrada en cascada + brillo.** Nalux pidió un "rayo dorado que pasa";
elegida, entre las opciones presentadas, la versión con **brillo neutro** (blanco/plata) en vez
de dorado fijo, para que combine con cualquier color de marca que el gimnasio elija (un dorado
fijo podría desentonar con un verde o celeste, por ejemplo). Implementado en
`components/AppLayout.jsx` (`NavLinksAnimados`): cada ítem entra con `framer-motion`
(`staggerChildren`) y un `motion.span` con gradiente translúcido cruza el botón una sola vez, con
un pequeño delay para sentirse "detrás" del texto, no encima. Verificado antes de subir con una
réplica visual aislada (HTML+CSS puro, **fuera del repo**, borrada después) simulando dos colores
de marca (magenta y verde): el brillo se ve bien en ambos.

El efecto **solo vive en el drawer del celular**, nunca en el sidebar fijo de la computadora —
decisión técnica, no solo de gusto: como cada página envuelve su propio `<AppLayout>` (no hay un
layout persistente a nivel de rutas), el sidebar se remonta en cada click de navegación; animarlo
ahí se vería como un parpadeo constante, no como "un menú que se despliega". El drawer sí es un
despliegue real a demanda del profesor. De paso, el propio drawer (fondo + panel) pasó de
aparecer/desaparecer de golpe a animarse con `AnimatePresence` al abrir y cerrar.

`framer-motion` ya estaba instalado (se usa en el embudo previo al login, `Reveal.jsx` y compañía)
así que esto no suma peso nuevo: build de producción antes/después, +5 KB sobre 1.2 MB.

**3. Bug real de usabilidad, no solo estético, encontrado en la misma auditoría:** varios lugares
usaban `--primary` (el color que cada gimnasio elige) para alertas, en vez de `--destructive`
(fijo siempre en rojo — `colorTema.js` lo deja sin tocar a propósito, ver el comentario ahí). Si
un gimnasio elegía, por ejemplo, verde o celeste como color de marca, "Atrasado", los cuadros de
error y el botón "Eliminar" en **toda la app** se veían en ese mismo tono amigable, sin ninguna
fuerza de alerta. Corregido en cuatro lugares:
- `ESTADOS_PAGO.vencido` (`lib/format.js`) — "Atrasado" en Pagos y en la ficha del alumno.
- `ErrorBox` y el botón `variant="danger"` (`components/ui-kit.jsx`) — este último es el que usan
  **todos** los "Eliminar"/"Quitar"/"Borrar" de la app; era el caso de mayor alcance.
- El cartel "Vencido" de "Planes por vencer" en el panel (`DashboardPage.jsx`).
- El calendario cíclico de asistencia dentro de la ficha del alumno (`AlumnoPage.jsx`,
  `AsistenciaAlumno`): tenía el mismo bug que ya se había corregido hoy más temprano en
  `AsistenciaPage.jsx`, pero es un componente paralelo distinto que se había quedado afuera de
  ese arreglo.

Pendiente para una próxima tanda (no implementado hoy, quedó priorizado en la propuesta del
agente): Google Fonts bloqueando el render (`@import` en `index.css`), Recharts sin lazy-load en
el Dashboard, color de fábrica más neutro y títulos de página sin `uppercase` sostenido,
transición en el `Modal`, hover consistente en `Btn`.

### Más del mismo día: segunda pasada de rediseño -- se cerró toda la lista pendiente

Nalux pidió seguir con el resto de la propuesta del agente y dijo "hazlo tú" -- sin nuevas
decisiones que consultarle, salvo una que ya se había resuelto en un tramo de la conversación
resumido antes de este punto (ver el punto 0). Quedó cerrada toda la lista que había quedado
pendiente en la entrada anterior:

**0. Color de fábrica -- ya decidido, no en esta tanda.** El `--primary`/`--accent`/`--ring` de
`index.css` (antes de que un gimnasio configure el suyo) pasó de un rojo saturado a un **dorado
brillante** (`42 92% 54%`, texto oscuro encima). Nalux pidió "que parezca como oro" y lo eligió
viendo tres variantes lado a lado -- la decisión y la implementación ya estaban en el working
directory cuando se retomó esta tanda (turno resumido). De paso `--warn` se corrió de 42° a 28°
(amarillo-dorado a naranja): con el `--primary` nuevo en 42°, "Próximo a vencer"/"Con deuda"
quedaban casi del mismo color que la marca y se confundían. `--destructive` no se tocó (sigue el
rojo fijo corregido en la tanda anterior). Ningún gimnasio con color propio configurado se ve
afectado -- `colorTema.js` sigue pisando estas variables apenas carga su `color_principal`.

**1. Google Fonts ya no bloquea el render.** El `@import` de `index.css` (bloqueante: el
navegador tenía que resolver la descarga externa antes de poder pintar el CSS propio) pasó a
`<link rel="preconnect">` + `<link rel="stylesheet">` en `index.html`, que bajan en paralelo con
el resto.

**2. Recharts diferido de verdad -- costó una vuelta extra.** Primer intento: diferir solo el
gráfico del panel (`components/GraficoIngresos.jsx`, `React.lazy` en `DashboardPage.jsx`). Build
de prueba: el bundle principal **no bajó de tamaño** (1220 KB, igual que antes) porque
`AlumnoPage.jsx` importaba recharts de forma estática para el gráfico de "Evolución del peso" --
con un segundo punto de entrada no-diferido, Rollup no puede separar la librería de verdad. Se
extrajo también ese gráfico (`components/GraficoPeso.jsx`) con el mismo patrón. Resultado medido:
el bundle principal bajó de **1220 KB a 826 KB (-32%)**, con recharts ahora en un chunk aparte
(`generateCategoricalChart`, 381 KB) que sólo se descarga cuando el profesor entra al panel o a la
pestaña de Progreso de un alumno.

**3. Títulos de pantalla sin `uppercase` sostenido** (`AppLayout.jsx`, el `<h1>` de cada
pantalla) -- las mayúsculas quedan reservadas para la marca (wordmark de Kairox y nombre del
gimnasio), que es donde aportan identidad en vez de sumar al tono "cartel de gimnasio de fierros".

**4. `Modal` con transición de entrada/salida** (`ui-kit.jsx`, `AnimatePresence` + fade del fondo
+ scale de la tarjeta) y **cierre con Escape** además de la X. A propósito NO se cierra con clic
en el fondo: la mayoría de estos modales son formularios largos (alta de alumno, registrar pago,
armar una rutina) y un clic al costado sin querer haría perder todo lo cargado.

**5. Hover consistente en `Btn`** (`hover:-translate-y-px` en los tres variantes) -- antes solo
las tarjetas del panel "respondían" al pasar el mouse por encima y los botones no.

**6. `Loading` con la forma real del contenido**, no bloques grises parejos: ahora imita una fila
de lista (avatar redondo + título + detalle más corto), que es la silueta de casi todas las
listas de la app.

Verificado con sesión real de profesor en local (no sólo lint/build): título de página sin
mayúscula, botón "Eliminar" en rojo fijo aunque el gimnasio de prueba tiene su color propio
(celeste) configurado, modal con transición y cierre por Escape, gráfico del panel cargando sin
errores de consola. Con esto **no queda nada pendiente** de la lista que dejó la auditoría del
agente `frontend-architect`.

### 08/09/2026 — Bug crítico: el alta de un gimnasio nuevo estaba rota (migración 0033)

Nalux probó crear una cuenta de profesor nueva ("Registrarse" en `/login`) y dio error. Investigado
por logs, no por reproducirlo a mano (no hay forma de loguearse como ella sin pedirle credenciales,
regla de la sesión) -- `auth_logs` mostró el `/signup` con status 200 y el perfil se creaba bien
(`profiles`, con `gimnasio_id` en NULL, que es lo esperado hasta completar el onboarding), pero
`postgres_logs` tenía, justo después:

```
null value in column "codigo_invitacion" of relation "gimnasios" violates not-null constraint
```

**Causa:** `create_gimnasio()` (la RPC que llama `OnboardingPage.jsx` al crear el gimnasio)
insertaba en `public.gimnasios` sin asignar `codigo_invitacion` -- columna `NOT NULL` y `UNIQUE`
(migración 0004, es el código que usa `/unirse/:codigo` para el autorregistro de alumnos), sin
ningún `DEFAULT`. El `INSERT` fallaba siempre, para cualquier usuario, no solo para esta prueba --
**el alta de un gimnasio nuevo estaba rota desde que se agregó esa columna**, probablemente porque
nadie había vuelto a probar el registro completo de punta a punta desde entonces.

**Arreglo:** `create_gimnasio()` ahora genera el código con el mismo patrón que ya usaba
`regenerar_codigo_invitacion()` (`encode(extensions.gen_random_bytes(16), 'hex')`, con reintentos
ante una colisión improbable contra el `UNIQUE`). Verificado con un `INSERT` de prueba dentro de una
transacción con `ROLLBACK` (no se creó ningún gimnasio de prueba real) -- ya no lanza el error.

Quedó una cuenta de prueba de Nalux (`nadia.creceonline@gmail.com`, "Micaela Tecera") con sesión
creada pero sin gimnasio, del intento que falló antes del fix -- no se tocó sin confirmar con ella
si reintentar el registro con esa cuenta ahora que anda, o si prefiere que se borre para empezar de
cero.

**Actualización, mismo día:** Nalux reintentó el registro y confirmó que ya funciona ("listo ya
funciono"). Se verificó en la base: el gimnasio "Full GYM" quedó creado con `codigo_invitacion`
válido y la cuenta con `role: admin`. Como ya la usó para probar exitosamente, esa cuenta **no se
tocó ni se borró** -- queda como cuenta real de prueba adoptada, mismo criterio que el resto de la
sesión con datos que el usuario ya usó.

### 08/09/2026 — El gimnasio nuevo se mostraba todo en rojo en vez del dorado de fábrica (migración 0034)

Reportado por Nalux con dos capturas: el panel de "Full GYM" (el gimnasio creado en la prueba de
arriba) se veía entero en rojo -- menú, íconos de las tarjetas, "CAJA DEL MES" -- en vez del dorado
nuevo de fábrica (`index.css`, cambiado más temprano esta sesión).

**Causa:** la columna `gimnasios.color_principal` tenía `DEFAULT '#E10600'`, el rojo viejo de
Kairox de antes del rediseño a dorado -- nadie lo había actualizado al cambiar el CSS. Como
`create_gimnasio()` nunca especifica `color_principal` al insertar, todo gimnasio nuevo recibía ese
rojo como valor **explícito** de la fila (no `NULL`), así que `aplicarColorGimnasio()`
(`lib/colorTema.js`) lo tomaba como "el profesor eligió este color" y lo aplicaba, pisando el
dorado de fábrica del CSS (que solo se ve cuando `color_principal` es `NULL`).

**Arreglo:** se sacó el `DEFAULT` de la columna (queda `NULL` hasta que el profesor elija un color
en Configuración) y se corrigió a `NULL` el único gimnasio ya afectado ("Full GYM"). Se confirmó
que "Mi GYM FIT" -- que tiene su propio color celeste elegido a propósito -- no se tocó, porque el
`UPDATE` filtraba específicamente por `color_principal = '#E10600'`.

### 08/09/2026 — Eliminar cuenta, con borrado completo en cascada (migración 0035)

Pedido de Nalux, sobre las mismas capturas del bug de arriba: poder eliminar la cuenta de un
profesor, **y que al borrarla se borre también de la base todo lo que estuvo cargado en esa
cuenta** -- no una baja lógica, un borrado real.

**Diseño:** antes de tocar código se revisaron las 17 foreign keys que apuntan a `gimnasios` --
16 tablas de negocio (alumnos, rutinas, pagos, asistencias, ejercicios propios, planes de
alimentación, notificaciones, configuración, progreso, etc.) ya tenían `ON DELETE CASCADE`, así
que borrar la fila de `gimnasios` ya arrastra todo eso solo. La única excepción a propósito es
`profiles.gimnasio_id` (`ON DELETE SET NULL`): un gimnasio puede tener más de un miembro de staff,
así que borrarlo no tiene por qué borrarles la cuenta a todos.

Nueva función `eliminar_mi_cuenta()` (`SECURITY DEFINER`, sin necesitar ningún `GRANT EXECUTE`
extra -- mismo criterio que `create_gimnasio()`, los privilegios por defecto ya alcanzan):
- Si quien la llama es **admin** de un gimnasio: borra el gimnasio entero (dispara los 16
  `CASCADE`).
- Siempre: borra su propia fila de `profiles` y, al final, su fila de `auth.users` directamente
  (confirmado antes de escribir esto que el rol `postgres`, dueño de la función, tiene privilegio
  `DELETE` explícito sobre `auth.users` en este proyecto -- no hace falta Edge Function ni Admin
  API). Borrar `auth.users` invalida la sesión y libera el correo para una cuenta nueva.
- Si quien la llama es **staff** (no admin): solo se borra su propio acceso -- el gimnasio del
  dueño y sus datos quedan intactos. No correspondería que un empleado borre todo el negocio del
  dueño solo por eliminar su cuenta personal.

**Hallazgo durante la implementación:** un intento de borrar también los archivos del gimnasio
(logo, fotos/videos de ejercicios en Storage) con un `DELETE FROM storage.objects` directo por SQL
lo rechazó un trigger de protección propio de Supabase ("Direct deletion from storage tables is not
allowed. Use the Storage API instead") -- borrar solo la fila del catálogo dejaría el archivo real
huérfano en el storage. Se resolvió del lado del cliente: `eliminarCuenta()` (`AuthContext.jsx`)
lista y borra esos archivos por la Storage API, con la sesión del propio admin (mismas policies de
las migraciones 0003/0005), *antes* de llamar a la función SQL.

**Decisión de producto que cambió a mitad de camino:** Nalux pidió inicialmente reautenticación con
contraseña + una "papelera" de 15 días (para poder recuperar una cuenta borrada por error), pero
con el requisito de que un correo recién borrado pudiera reusarse de inmediato para una cuenta
nueva -- ambas cosas chocan (Supabase Auth no permite dos filas de `auth.users` activas con el
mismo correo). Al preguntarle cómo se recuperaría una cuenta en esos 15 días, decidió simplificar:
**sin papelera, borrado definitivo e inmediato**, y que el correo quede libre al toque porque la
fila realmente se borra. Se mantuvo sí la reautenticación con contraseña.

**Frontend** (`ConfiguracionPage.jsx`, sección "Eliminar cuenta", tarjeta con
`border-destructive`): botón que abre un `Modal` pidiendo la contraseña, con el texto de
advertencia distinto según sea admin (borra el gimnasio entero) o staff (borra solo su acceso).
`eliminarCuenta(password)` en `AuthContext.jsx` reautentica con `signInWithPassword` antes de
tocar nada -- si la contraseña no coincide, no se ejecuta nada. Tras confirmar, el modal muestra
una pantalla de "Cuenta eliminada" por ~2 segundos (mismo patrón que `ResetPasswordPage.jsx`) y
recién ahí llama a `signOut()`, que dispara el redirect automático a `/login` vía `ProtectedRoute`.

**Verificado sin tocar ninguna cuenta real:** función probada dos veces dentro de una transacción
`BEGIN`/`ROLLBACK` con filas 100% descartables (`auth.users`, `gimnasios`, `alumnos` de prueba,
simulando la sesión con `SET LOCAL request.jwt.claims`) -- una vez como admin (confirmó que
`auth.users`, `profiles`, `gimnasios` y `alumnos` quedan todos en cero) y otra vez como staff
(confirmó que solo se borra la cuenta del empleado, con el gimnasio y el admin dueño intactos).
Nada de esto persistió: todo se revirtió con `ROLLBACK`.

Nalux lo probó de punta a punta en local con una cuenta real de prueba y confirmó que anda
("listo se borro bien").

### 08/09/2026 — Ojito para mostrar/ocultar contraseña en toda la app

Pedido de Nalux, junto con la confirmación de que el borrado de cuenta funcionaba: agregar el
botón de mostrar/ocultar (el "ojito") a cada caja de contraseña de la app, no solo a la nueva de
"Eliminar cuenta".

Se armó un solo componente compartido, `PasswordInput` (`ui-kit.jsx`), en vez de repetir el botón
en cada pantalla: envuelve el `<input>` en su propio `position: relative` y agrega el botón del
ojito (`Eye`/`EyeOff` de lucide-react) alterando `type="password"`/`type="text"` con estado local.
`tabIndex={-1}` a propósito: es un atajo visual, no un campo del formulario, así que no debe
interrumpir el paso normal de tab de "Contraseña" al botón de enviar.

Reemplazó los `<Input type="password">` sueltos en las **5 cajas de contraseña** que había en la
app: `LoginPage.jsx` (entrenador), `AlumnoLoginPage.jsx` (alumno), `ResetPasswordPage.jsx` (nueva
contraseña + confirmar, son dos), y la nueva de `ConfiguracionPage.jsx` (eliminar cuenta). Las
pantallas que ya tenían un ícono de candado a la izquierda (`Lock`, con el input en `pl-9`) lo
conservan tal cual -- `PasswordInput` solo resuelve el botón de la derecha, el candado sigue
siendo responsabilidad de cada pantalla.

Verificado en `/login`: se probó escribiendo una contraseña de prueba y alternando el botón --
pasa de puntos a texto plano y de vuelta, con el ícono y el `aria-label` ("Mostrar
contraseña"/"Ocultar contraseña") cambiando en cada click.

### 08/09/2026 — Verificar el correo al registrarse (pendiente: falta un paso en el Dashboard de Supabase)

Pedido de Nalux: que al registrarse un profesor, se confirme que el correo existe de verdad (mail
de verificación) en vez de aceptar cualquier texto con forma de correo.

**Investigado antes de tocar nada:** el frontend (`LoginPage.jsx`) **ya está preparado para esto
desde antes** -- `onSubmit` ya revisa si `signUp()` devuelve una sesión: si la hay, entra directo
(`Confirm email` desactivado); si no, muestra "Cuenta creada. Revisar el correo para confirmar
antes de ingresar." (`Confirm email` activado). Se confirmó en la base que hoy está **desactivado**:
la única cuenta que queda en `auth.users` tiene `email_confirmed_at` a 33 milisegundos de
`created_at` -- se autoconfirmó sola, nadie hizo clic en ningún link.

**Por qué no se activó directo:** `Confirm email` no es una tabla ni una función de Postgres -- es
una configuración del servicio de Auth de Supabase (GoTrue), que se prende desde el Dashboard del
proyecto (o la API de administración de Supabase, no la base de datos). Ninguna herramienta
disponible acá llega a ese nivel, así que **le queda a Nalux prenderlo a mano**:
`Authentication → Sign In / Providers → Email → "Confirm email"`, activarlo.

**Lo que sí se hizo desde el código:** `signUp()` (`AuthContext.jsx`) ahora manda
`emailRedirectTo: window.location.origin`, mismo criterio que ya usa `resetPasswordForEmail` --
sin esto, el link del mail de confirmación volvería siempre al "Site URL" fijo del proyecto,
sin importar si el registro se hizo en local o en producción. Apunta a la raíz de la app (no a una
pantalla propia): en cuanto `ProtectedRoute` detecta la sesión ya confirmada, redirige solo a
`/onboarding`.

**Configuración completada en el Dashboard, guiando a Nalux paso a paso (ninguna herramienta
disponible acá llega a estos ajustes, son del servicio de Auth, no de la base):**
1. **SMTP propio:** en vez del mailer limitado de Supabase, se conectó como remitente el Gmail
   `equipokairox.ia@gmail.com` (`Authentication → Emails → SMTP Settings`), con una "Contraseña de
   aplicación" de Google (nunca la contraseña real de esa cuenta, y nunca pasada por este chat --
   Nalux la generó y la pegó directo en Supabase).
2. **URL Configuration:** se agregaron `http://localhost:3001/**` y
   `https://gimnasio-gestion-app-web.vercel.app/**` a las Redirect URLs (antes solo estaban las de
   `/restablecer-password`, ninguna cubría el link de confirmación de cuenta), y se corrigió el
   Site URL de `http://localhost:3001` a la URL de producción -- ese campo es el destino de
   respaldo cuando un link no matchea ninguna Redirect URL, tenerlo en localhost hubiera mandado a
   cualquier usuario real ahí.
3. **`Confirm email` activado** en `Sign In / Providers → Email`.

**Verificado de punta a punta con un registro real** (`nadia.creceonline@gmail.com`, mismo email
de prueba de la migración 0033): por los logs de `auth_logs` se vio la secuencia completa --
`POST /signup` (200) → `user_confirmation_requested` → `GET /verify` (303) con
`email_confirmed_at` recién ahí seteado en la base. La confirmación en sí funciona.

**Dos problemas reales que salieron de esa prueba, y cómo quedaron:**
- **El mail cae en spam:** esperable con un Gmail personal como remitente -- no tiene la reputación
  ni las firmas (SPF/DKIM/DMARC) de un proveedor pensado para correo transaccional, que es
  justo lo que ya advertía Supabase al cargar el SMTP. Se le ofreció migrar a Resend (mejor
  entrega, plan gratis); **Nalux decidió seguir con Gmail por ahora**. Mitigación aplicada en
  el código: el mensaje de "Cuenta creada" en `LoginPage.jsx` ahora suma "revisar también la
  carpeta de spam".
- **El link llevaba a una página que no cargaba:** pasó porque la prueba se hizo con la app abierta
  en `localhost:3001`, así que el link de confirmación apuntaba ahí -- si se abre desde otro
  dispositivo o sin el server local corriendo, no hay nada que responda. No es un bug: un usuario
  real que se registre desde la URL de producción va a recibir un link a esa URL, siempre
  accesible. No hace falta re-probarlo aparte -- la confirmación en sí ya quedó probada por los
  logs, independientemente de a dónde redirija después.

**Plantilla del mail, en español** (pedida después, ya aplicada): se le armó el texto y Nalux lo
pegó en `Authentication → Email Templates → Confirm signup` -- asunto "Confirmar cuenta - Gestión
GYM Kairox IA" y cuerpo HTML propio (botón dorado `#c9a86a`, el mismo de la marca, más el link en
texto plano abajo por si algún cliente bloquea el HTML). Ojo: el **asunto es un campo aparte** del
cuerpo en esa pantalla y es fácil pasarlo por alto -- quedó en el default en inglés hasta que se
corrigió en un segundo paso.

**Re-probado de punta a punta desde producción** (no local, para que el link fuera a una URL
siempre accesible): registro → mail con la plantilla nueva → confirmación → onboarding → panel.
Nalux confirmó que el correo se ve bien. De paso se vio que el gimnasio nuevo salió con el dorado
de fábrica, o sea que el fix de la migración 0034 sigue firme.

**Gotcha que apareció en el medio, para no volver a tropezar:** al borrar una cuenta directo por
SQL (para reusar el correo en otra prueba), el navegador **se queda con la sesión vieja** -- el
token no se invalida solo. La app entonces cree que hay sesión, no encuentra el perfil, y manda a
`/onboarding` en vez de mostrar el login, sin ningún error visible. Confirmado reproduciéndolo en
otro navegador y viendo la clave `sb-<proyecto>-auth-token` en el localStorage: al borrarla, el
login carga normal. Esto NO pasa cuando la cuenta se borra desde la propia app ("Eliminar cuenta"),
porque ahí `eliminarCuenta()` hace el `signOut()` después. Si en el futuro se borra una cuenta a
mano por SQL, hay que limpiar el localStorage de ese navegador (o usar otro) antes de re-probar.

**Cuenta de prueba viva:** quedó "FULL GYM NT" (`nadia.creceonline@gmail.com`), que Nalux dijo
expresamente que va a seguir usando para probar -- **no borrarla** sin consultarle primero.

### 08/09/2026 — Foto del alumno: de URL pegada a archivo subido (migración 0036)

Pedido de Nalux: en la ficha del alumno, el campo de foto era una URL de texto libre
("Foto (URL opcional)") -- en la práctica el profesor tiene la foto en el celular o la compu, no
un link ya público. Pidió cambiarlo a subida de archivo, manteniéndolo opcional.

**Nuevo bucket `alumnos-fotos`** (migración 0036), mismo patrón que ya usan `gimnasio-logos`
(0003) y `ejercicios-media` (0005): path `{gimnasio_id}/{alumno_id}.<ext>`, 2 MB de tope, solo
PNG/JPG/WEBP, policies que atan cada archivo a una fila real de `public.alumnos` del propio tenant
(mismo fix de cuota que encontró la revisión de AppSec en 0005), sin exigir `role='admin'` porque
`alumnos_tenant_isolation` (0001) tampoco lo exige.

**Decisión de privacidad, documentada en la cabecera de la migración:** a diferencia del logo y el
media de ejercicios (marca/contenido genérico), una foto de alumno sí identifica a una persona
real. Se decidió igual mantener el bucket público (lectura sin autenticación) por consistencia con
el resto del storage de la app y para no sumar la complejidad de URLs firmadas -- la mitigación es
que el path incluye el UUID del alumno, no adivinable ni enumerable. Vale la pena revisarlo si en
algún momento se necesita más privacidad que eso.

**Frontend** (`AlumnosPage.jsx`): mismo flujo que `EjerciciosPage.jsx` para su media -- primero se
guarda (crea o actualiza) la fila del alumno, recién después se sube el archivo (la policy del
bucket exige que la fila ya exista), y si la subida falla el alumno igual queda guardado, con un
aviso ("se guardó, pero la foto no se pudo subir") en vez de perder el resto de los datos
cargados. El campo pasó de `<Input>` de texto a un `<input type="file">` con preview, mismo look
que el logo del gimnasio en `ConfiguracionPage.jsx`.

Verificado con `npx vite build` (limpio, sin errores) y lint. Nalux la probó en producción
("listo, seguimos con la parte de alumnos", sin reportar ningún problema).

### 09/09/2026 — Revisión de la sección Alumnos: 3 borrados sin confirmación

Pedido de Nalux: revisar en general la lista y la ficha del alumno buscando cosas para mejorar
(sin pedido puntual). Encontrados y corregidos, los dos más graves:

- **"Eliminar pago" (ficha del alumno, pestaña Pagos):** un solo clic y el pago desaparecía para
  siempre, sin ningún aviso -- grave porque cada pago es también el comprobante numerado
  (migración 0013), perderlo por error pierde esa numeración para siempre. El ícono además estaba
  pintado con `text-primary` (el color de marca del gimnasio) en vez de `text-destructive` -- mismo
  bug de color ya corregido en otros botones esta semana, este quedó suelto.
- **"Eliminar alumno" (lista de Alumnos):** un clic borraba en cascada TODO el historial del
  alumno (pagos, asistencias, rutina y plan de alimentación asignados, medidas), sin confirmación.
- **"Eliminar registro" (ficha del alumno, pestaña de medidas/progreso):** mismo patrón que
  "Eliminar pago" -- sin confirmar y con `text-primary` en vez de `text-destructive`.

**Arreglo:** los tres ahora piden confirmación con `window.confirm()` (mismo patrón ya usado en
"Eliminar rutina" de `RutinasPage.jsx`, sin armar un modal aparte para una acción de lista) con un
mensaje específico de qué se pierde en cada caso, y los dos íconos de tachito pasaron a
`text-destructive`.

### 09/09/2026 — Alta de alumnos por link/QR: la pantalla que faltaba (migración 0004)

Mismo pedido de revisión: el backend de autorregistro (`gimnasios.codigo_invitacion`,
`autorregistro_activo`, las RPC `join_gimnasio_por_codigo()`/`listar_planes_para_codigo()`/
`regenerar_codigo_invitacion()`, la ruta pública `/unirse/:codigo`) **ya existía desde la
migración 0004** (18/08/2026) -- pero, tal como quedó documentado en el propio archivo de esa
migración como "pendiente, fuera de alcance", **nunca se construyó la pantalla** donde el profesor
pudiera ver, copiar, compartir o regenerar ese link, ni prender/apagar el autorregistro. El estado
"Pendiente" de un alumno ya mencionaba "se autorregistró por QR" en el texto de ayuda de
`AlumnosPage.jsx`, pero no había ningún QR que mostrar.

**Se construyó en `ConfiguracionPage.jsx`**, nueva tarjeta "Alta de alumnos por link":
- Checkbox para `autorregistro_activo` (UPDATE directo sobre `gimnasios`, ya cubierto por la
  policy `gimnasios_update_admin` de la migración 0001 -- no hizo falta ninguna función nueva).
- El link (`{origin}/unirse/{codigo_invitacion}`) en una caja con botón de copiar
  (`navigator.clipboard`).
- El QR generado con la librería `qrcode` -- **ya estaba instalada en `package.json` desde antes,
  sin usarse en ningún lado** (`QRCode.toDataURL()`, del lado del cliente, sin depender de ningún
  servicio externo).
- Botón "Regenerar código" con confirmación inline (mismo patrón "¿Seguro?" que "Archivo de
  pagos"), porque invalida cualquier link o QR ya compartido/impreso.

**Verificado sin crear ningún alumno de prueba real:** se armó el build de producción
(`npx vite build`, limpio, bundle principal 830 → 862 KB por la librería QR) y se navegó
directo a `https://.../unirse/{codigo real de "Full GYM NT"}` (sin sesión, tal como llegaría un
alumno real escaneando el QR) -- la pantalla pública cargó bien, con los planes reales del
gimnasio (Mensual, Trimestral) en el selector. No se envió el formulario a propósito, para no
generar una fila de alumno falsa.

De paso se encontró y se borró un gimnasio "Full GYM NT" duplicado y huérfano (sin ningún
profesor asociado, sin alumnos) que había quedado de las pruebas del día anterior -- basura de
prueba, no el que Nalux está usando.

### 09/09/2026 — Corrección: el QR que Nalux pedía era otro (login del alumno, no autorregistro)

Al ir a probar en vivo lo de arriba, Nalux frenó: **"el profesor se tiene que encargar de
registrarlos"**. Resultó que su pedido original ("un link y un QR en donde el alumno escanee... y
lo mande al login de alumno **ya creado su perfil** (el profe ya le tuvo que haber creado el
login)") no era el autorregistro público -- era otra cosa, y se había construido la función
equivocada.

**Lo que efectivamente quería:** el profesor sigue creando cada alumno y su usuario/contraseña a
mano (como ya se hacía, vía `crear_acceso_alumno()`, migración 0028); lo que faltaba era
simplemente **un QR/link fijo a la pantalla de login del alumno (`/alumno`)**, para no tener que
dictar la URL: o se lo escanea en el momento con el celular del alumno, o se copia y se manda por
WhatsApp.

**Implementado en `AlumnoPage.jsx`**, dentro de la tarjeta "Acceso del alumno" que ya existía: un
QR de `{origin}/alumno` + el link con botón de copiar, visibles solo cuando ese alumno ya tiene
usuario creado (si no, no habría con qué entrar del otro lado). Es el **mismo QR para todos los
alumnos del gimnasio** -- no identifica a nadie, solo abre el login; cada alumno igual necesita su
propio usuario/contraseña. Convive con el botón "Enviar por WhatsApp" que ya estaba (ese sí es por
alumno, porque incluye la contraseña recién creada en texto plano, la única vez que se puede ver).

**Migración 0037, consecuencia de la misma charla:** `gimnasios.autorregistro_activo` tenía
`DEFAULT true` desde la migración 0004, así que todo gimnasio nuevo nacía con el autorregistro
público prendido sin que ningún profesor lo hubiera elegido (nunca se había notado porque hasta hoy
no existía la pantalla para verlo). Pasó a `DEFAULT false` y se apagó en los gimnasios existentes:
queda como una opción que se prende a propósito desde Configuración, no como el comportamiento por
defecto. **La tarjeta "Alta de alumnos por link" se mantiene** -- funciona y está probada, solo
que ahora apagada salvo que alguien la quiera.

### 09/09/2026 — Autorregistro con alcance acotado + aviso al profesor (migración 0038)

Tercera vuelta sobre el mismo tema, y la definitiva. Después de haber pedido sacar la tarjeta de
autorregistro, Nalux cerró el alcance real: **sí** quiere que los alumnos se anoten solos con el
link/QR que les pasa el profesor, pero cargando **solo sus datos personales** -- "al resto lo carga
después el profesor si lo da de alta" -- y con un **aviso al profesor** de que hay alguien nuevo
esperando que le completen los datos.

**Decisiones tomadas con ella antes de escribir código:**
- **Foto en el autorregistro: no.** Subir archivos sin sesión exigiría abrir una puerta de
  escritura pública al Storage (riesgo real: alguien con el link llenando el bucket de basura). La
  sube el profesor después desde la ficha, que ya funciona. Eligió esta opción sobre habilitarla.
- **Plan: se saca del formulario público.** Lo asigna el profesor al dar de alta.
- **Edad: no es un campo.** Se calcula desde la fecha de nacimiento y se muestra al tipear;
  guardar las dos cosas invita a que se contradigan.
- Se le aclaró un malentendido: el alumno **no se loguea con correo**, entra con el
  usuario/contraseña que le crea el profesor. El correo es un dato de contacto más.

**Migración 0038** -- `join_gimnasio_por_codigo()` recreada (DROP + CREATE, no REPLACE: cambia la
firma, y una sobrecarga conviviendo dejaría a PostgREST sin saber cuál llamar; ojo que el DROP se
lleva los GRANT, se re-otorgan al final). Ahora recibe DNI, fecha de nacimiento y contacto de
emergencia, y ya no recibe plan. Se mantuvieron intactas todas las defensas de la 0004 (topes de
largo, rate-limit por gimnasio, `activo=false` siempre, gimnasio_id resuelto solo por el código,
error genérico). Incluye además:

- **Arreglo de un bug latente:** un alumno autorregistrado quedaba con `activo=false` **y
  `pendiente=false`** (la función nunca seteaba `pendiente`, que tiene DEFAULT false). Como
  `estadoAlumno()` lee `activo ? activo : pendiente ? pendiente : inactivo`, ese alumno aparecía
  como **"Inactivo"** -- el balde de los que se dieron de baja -- y **no salía en el filtro
  "Pendientes"** que usa el profesor. Ahora entra con `pendiente = true`.
- **Revierte la migración 0037**, que había apagado el autorregistro partiendo de que no se iba a
  usar. Vuelve a `DEFAULT true` y se reactiva en los gimnasios existentes.

**Frontend:**
- `UnirsePage.jsx`: formulario nuevo -- Nombre y Apellido (separados, se unen en `alumnos.nombre`,
  que es una sola columna), Teléfono, y como opcionales Correo, DNI, Fecha de nacimiento (con la
  edad calculada al lado) y Contacto de emergencia. Sin selector de plan.
- `NotificacionesCampana.jsx`: la campanita ahora también trae los alumnos con
  `activo=false, pendiente=true, origen='autorregistro'` y los muestra **arriba de todo**, con
  badge "Nuevo" y el texto "Se anotó solo -- faltan sus datos", llevando a la ficha (sin pestaña,
  porque lo que hay que hacer ahí es completar datos, no cobrar). El contador de la campana suma
  los dos grupos.

**Verificado:** la RPC probada con `SET LOCAL role = 'anon'` dentro de una transacción con
`ROLLBACK` (nada quedó en la base) -- todos los campos guardan bien y el estado visible calculado
da `pendiente`, no `inactivo`. El formulario probado en el navegador en `localhost:3001` con el
código real de "Full GYM NT": rinde los 7 campos, sin plan, y la edad se calcula sola (31 años
para 18/04/1995). Build de producción limpio.

**Falta probar en vivo con Nalux:** anotarse de verdad desde el celular con el QR y confirmar que
aparece la notificación en la campanita del profesor.

### 09/09/2026 — El botón de copiar el link fallaba en silencio

Reportado por Nalux probando el QR en la ficha del alumno: "aprieto pero no se copia, ni me dice
nada".

**Causa, diagnosticada en vivo (no adivinada):** se armó un botón de prueba temporal en la página
pública y se lo hizo clic con un clic real del navegador, midiendo los dos caminos por separado.
Resultado: `navigator.clipboard.writeText()` devuelve **NotAllowedError** en el navegador embebido
donde Nalux estaba probando (el panel del propio Claude Code), incluso con un clic legítimo de por
medio -- ese contexto bloquea la API moderna por política de permisos. Y el código original tenía
esa llamada adentro de un `try/catch` que se tragaba el error sin hacer nada: ni copiaba, ni
avisaba. En un Chrome normal probablemente funcionaba, por eso no se había notado.

**Arreglo** -- nuevo `lib/copiar.js` con `copiarAlPortapapeles()`, usado por los dos botones (la
ficha del alumno y la tarjeta de Configuración):
- Intenta la API moderna y, si falla o no existe, cae al método viejo (textarea temporal +
  `document.execCommand('copy')`), que no pide permisos. **Verificado en el mismo navegador donde
  fallaba: el respaldo devuelve ok.**
- Devuelve true/false para que quien llama pueda avisar en pantalla.
- El botón ahora dice **"Copiar" / "Copiado"** con texto, no solo un ícono que cambiaba 2 segundos
  (parte del "ni me dice nada" era eso), y si los dos caminos fallan muestra un aviso explícito.
- El link pasó de `<span>` a un `<input readOnly>` que se autoselecciona al tocarlo, para poder
  copiarlo a mano como último recurso.

### 09/09/2026 — "Los datos se tienen que poder ver": recuperar el acceso de un alumno

Nalux, sobre el cartel "después no se van a poder volver a ver" de la ficha: *"se tiene que poder
ver, porque a lo mejor el alumno pierde el acceso y no puede entrar, el profe le vuelve a mandar el
link"*.

**Se verificó primero cómo estaba guardada:** `crear_acceso_alumno()` usa
`crypt(p_contrasena, gen_salt('bf'))` -- bcrypt. La contraseña no es recuperable ni para la propia
app, no es una limitación de la pantalla. Mostrarla de nuevo exigiría guardarla en texto plano, y
son contraseñas de terceros (los alumnos), que además suelen reusarlas en otros lados. Se le
plantearon las dos opciones con el riesgo explícito; **eligió mantenerlas cifradas** y resolver la
recuperación generando una nueva.

**Cambios en `AlumnoPage.jsx` (`AccesoAlumno`):**
- Se sacó el cartel alarmante. Ahora explica el camino: la contraseña se guarda cifrada, y si el
  alumno la pierde se le crea una nueva con "Cambiar contraseña" y se le reenvía.
- **Botón "Reenviar link" siempre a mano** (antes el de WhatsApp aparecía solo justo después de
  crear el acceso). El mensaje se arma distinto según el caso: recién creada va con
  usuario + contraseña; después va solo con el link y el usuario, porque la contraseña ya no
  existe en texto plano en ningún lado.
- Nota fija debajo del usuario actual explicando qué hacer si la perdió.

**Prueba en vivo del lado del alumno** (pedida por Nalux, hecha en `localhost:3001` contra "Full
GYM NT", su gimnasio de pruebas -- nunca contra "Mi GYM FIT"):
1. Se completó y envió el formulario público de autorregistro como lo haría un alumno real.
2. Se verificó en la base: nombre y apellido unidos bien ("PruebaBorrar TestAutorregistro"), todos
   los campos guardados (teléfono, correo, DNI, fecha de nacimiento, contacto de emergencia),
   `fecha_alta` de hoy, plan y foto en NULL (los carga el profesor), y **estado visible
   "pendiente"**.
3. Se corrió el filtro exacto de la campanita: levanta ese alumno.
4. Se probó el login del alumno con las RPC reales, dentro de transacciones con `ROLLBACK`:
   - Contraseña incorrecta -> rechazada.
   - Contraseña correcta pero alumno **todavía pendiente** -> **rechazada también**
     (`iniciar_sesion_alumno` exige `activo = true`). No es un bug: un alumno sin aprobar no entra
     a nada.
   - Aprobado + con acceso creado -> **entra bien**.
5. Se borró el alumno de prueba al terminar; no quedó nada en la base.

### 09/09/2026 — Rediseño de la pantalla del alumno (MiPlanPage), sobre feedback de uso real

Nalux revisó la pantalla que ve el alumno en la compu y en el celular, y pasó cinco cosas
concretas. Todas resueltas:

**1. Ancho en computadora.** El contenido estaba clavado en `max-w-2xl` (672px), o sea una columna
angosta en el medio de una pantalla grande. Se agregó `lg:max-w-5xl` al `<main>` y al header:
medido en el navegador, el contenido pasa de 672px a **1024px** a partir de 1024px de viewport,
centrado y sin scroll horizontal. En el celular no cambia nada (nunca se llega a `lg`).

**2. No se distinguía dónde terminaba la rutina y empezaba la alimentación.** Las dos secciones
usaban exactamente el mismo tratamiento visual, así que al scrollear se leían como una sola lista
larga. Ahora cada una tiene **banda de encabezado con color propio**: rutina con el color del
gimnasio (`--primary`) y alimentación con el verde de `--ok`, incluidos los subtítulos (cada
comida, "Observaciones generales") y el botón de PDF de esa sección. `--ok` ya existe en los dos
temas -- no es un color inventado ni pisa el color de marca que eligió cada gimnasio.

**3. Cajas muy grandes en el celular.** El `p-5` estaba fijo para todos los tamaños. Pasó a
`p-4 sm:p-5` en las tarjetas de la rutina y de las comidas, y los textos largos de comidas y
observaciones a `text-base sm:text-lg`.

**4. Superseries en una sola línea, también en el celular.** Era
`flex-col ... sm:flex-row`: abajo de 640px los ejercicios del combo quedaban uno debajo del otro y
se leían como ejercicios sueltos, perdiendo justamente lo que hace que sea una superserie. Ahora
es `flex-row` siempre.

**5. Que se pueda leer.** Pedido explícito: *"que tampoco se vea chico... porque hay personas
grandes que tienen que leer también"*. Al poner los dos ejercicios lado a lado había lugar para
achicar la letra, y se hizo lo contrario: el nombre subió de `text-sm` a `text-base`, el grupo
muscular de `text-xs` a `text-sm`, y series/reps/peso de `text-sm` a `text-base`. Además se sacó
el `truncate`: con dos al lado el nombre entra en dos renglones pero **completo**, en vez de
cortarse con puntos suspensivos.

**Verificado en el navegador**, a 375px (celular) y a 1440px (computadora), con el plan real de un
alumno de "Mi GYM FIT": superserie en una línea y legible, bandas de color separando bien las dos
secciones, y el ancho de la computadora medido por consola.

**Aparte, sobre el mensaje de WhatsApp:** Nalux notó que al reenviar el link va el usuario pero no
la contraseña. Es la consecuencia esperada de mantenerlas cifradas (ver la entrada anterior), pero
el mensaje quedaba leyéndose como incompleto. Ahora aclara: *"La contraseña es la que te pasé
cuando creamos el acceso; si no la tenés a mano, avisame y te paso una nueva"*.

### 09/09/2026 — El mensaje de WhatsApp tiene que llevar la contraseña sí o sí

Nalux, sobre el cambio anterior: *"lo mismo en el mensaje le tiene que decir la contraseña"*. No
alcanzaba con explicar por qué no estaba -- tenía que estar.

Como la contraseña vieja sigue sin ser recuperable (bcrypt, ver las dos entradas anteriores), la
única forma de que el mensaje la lleve es **generar una nueva ahí mismo**. Se armó así:

- Botón nuevo **"Enviar con contraseña nueva"** junto a "Reenviar solo el link" (ese se mantiene
  para cuando el alumno solo perdió el link, no la contraseña -- no hace falta regenerar nada en
  ese caso). Pide confirmación inline primero ("la anterior deja de servir"), porque cambia el
  acceso de verdad.
- Al confirmar: genera una contraseña de 6 caracteres (3 letras + 3 números, **sin l/1/I/0/O** --
  se tipea a mano en el celular de alguien, o se dicta, así que se evitan los caracteres que se
  confunden entre sí), llama a `crear_acceso_alumno()` con el usuario que ya tenía, y abre
  WhatsApp con el mensaje completo: link + usuario + la contraseña nueva.
- El recuadro verde de "Acceso guardado" con usuario/contraseña también queda visible en pantalla
  después, por si se prefiere copiarlo y pasarlo por otro lado en vez de WhatsApp.

**Verificado sin tocar ningún alumno real:** dentro de una transacción con `ROLLBACK`,
`crear_acceso_alumno()` con una contraseña de ese mismo formato (`abc234`) seguido de
`iniciar_sesion_alumno()` con esa contraseña -- login correcto. Nada persistió.

### 09/09/2026 — Contraseñas: exigir al menos una mayúscula (profesor y alumno)

Pedido de Nalux: *"hay que exigir la profe la contraseña, que al menos tenga una mayúscula cuando
cree el login de los alumnos, tanto el profe cuando cree la cuenta"*.

Nuevo helper compartido `lib/validacionPassword.js` (`validarContrasena(contrasena, minLength)`,
`tieneMayuscula()`), para no repetir la regla y el mensaje en cada formulario. Se mantiene el
mínimo de caracteres que ya tenía cada uno (6 profesor, 4 alumno) y se le suma la mayúscula.

**Aplicado en 3 lugares del lado del cliente**, cada uno con una leyenda debajo del campo
("Mínimo X caracteres, con al menos una mayúscula") para que se sepa la regla antes de
equivocarse, no recién al enviar:
- `LoginPage.jsx`: solo al **registrarse**, no al iniciar sesión -- una cuenta creada antes de esta
  regla no tiene por qué dejar de poder entrar.
- `ResetPasswordPage.jsx`: al definir una contraseña nueva.
- `AlumnoPage.jsx` (`AccesoAlumno`): al crear o cambiar el usuario/contraseña de un alumno.

**Reforzado también del lado de la base** (migración 0039): `crear_acceso_alumno()` ahora rechaza
con `RAISE EXCEPTION` una contraseña sin mayúscula, además de la validación del cliente -- es una
función llamable por RPC directo por cualquier profesor autenticado (RLS ya la limita a su propio
gimnasio; no es `SECURITY DEFINER`), así que la validación del formulario sola no alcanzaba como
única barrera.

**Se encontró de paso un problema real:** el generador automático de contraseñas del botón "Enviar
con contraseña nueva" (agregado en la entrada anterior) armaba 3 minúsculas + 3 números -- **sin
ninguna mayúscula**, así que hubiera chocado con esta regla nueva. Se corrigió para que la primera
letra salga en mayúscula (sigue siendo fácil de dictar: "mayúscula, dos minúsculas, tres números").

**Verificado:**
- La UI de registro, en el navegador: sin mayúscula muestra el error y no llega a crear la cuenta;
  con mayúscula, `validarContrasena()` devuelve `''` (válida).
- La RPC, dentro de una transacción con `ROLLBACK`: sin mayúscula rechazada
  (`crear_acceso_alumno()` lanza la excepción), con mayúscula acepta y el login del alumno
  funciona. Nada persistió.

Pendiente, sin urgencia: Supabase Auth tiene su propia política de fuerza de contraseña
configurable desde el Dashboard (mismo lugar que "Confirm email"), que reforzaría esto también del
lado del servidor para el signup del profesor. No se tocó porque la validación del cliente ya
cubre el pedido; se puede sumar después si Nalux quiere ese refuerzo extra.

### 09/09/2026 — Ajuste el mismo día: la contraseña del alumno pasa a mínimo 8

Nalux, después de ver lo de arriba: *"que la contraseña del alumno sea mínimo 8 caracteres, con
una mayúscula"* -- el mínimo específico del alumno (que había quedado en 4, el que ya tenía antes)
sube a 8. La regla de la mayúscula no cambia, ya estaba.

- `AlumnoPage.jsx`: `validarContrasena(contrasenaForm, 8)`, `minLength={8}` y el placeholder/pista
  actualizados.
- Migración 0040 (sobre la 0039 del mismo día): `crear_acceso_alumno()` ahora exige
  `length >= 8` en vez de `>= 4`.
- **Se corrigió también el generador automático** del botón "Enviar con contraseña nueva" (que ya
  se había ajustado horas antes para tener mayúscula, pero seguía dando 6 caracteres): pasa a
  1 mayúscula + 3 minúsculas + 4 números = 8, mismo criterio de "fácil de dictar" y sin caracteres
  ambiguos.

**Verificado:** dentro de una transacción con `ROLLBACK`, 7 caracteres con mayúscula rechazado por
longitud, 9 caracteres aceptado con login correcto. El generador de contraseña, probado en el
navegador: 8 caracteres, con mayúscula.

### 09/09/2026 — Aprobar un alumno pendiente le crea el acceso de una

Nalux, cerrando el círculo del autorregistro: *"quiero que cuando se apruebe ya el alumno tenga
acceso a su plataforma... que el alumno con su nombre ponga el usuario y una contraseña que
después la pueda ver el profe o se la pueda cambiar... sino no tiene sentido mandarle para que se
registre y no tenga acceso al panel"*.

Hasta ahora, "Activar" (tanto en la lista como si hubiera existido en la ficha) solo cambiaba
`activo`/`pendiente` -- el alumno quedaba activo pero sin login, un paso manual aparte que nadie
se acordaba de hacer.

**Nuevo `lib/accesoAlumno.js`**, compartido:
- `usuarioBaseDesdeNombre(nombre)`: primer nombre, sin acentos ni espacios, en minúsculas (mismo
  estilo que ya usaba Nalux a mano, "nadia1"). Nombres muy cortos se completan para no chocar con
  el mínimo de 3 caracteres de `crear_acceso_alumno()`. Probado con acentos, ñ, nombres de 2
  letras y vacío.
- `generarContrasenaAlumno()`: la misma lógica que ya tenía "Enviar con contraseña nueva"
  (8 caracteres, con mayúscula, sin l/1/I/0/O), ahora en un solo lugar -- se sacó la copia
  duplicada de `AlumnoPage.jsx`.
- `crearAccesoAutomatico(alumno)`: llama a `crear_acceso_alumno()` con el usuario armado desde el
  nombre; si choca con uno que ya existe (`unique_violation`, mismo mensaje que ya devolvía esa
  función), reintenta agregando un número al final (`jose`, `jose2`, `jose3`...) hasta 20 intentos.

**`AlumnoPage.jsx` (ficha, tarjeta "Acceso del alumno"):** cuando el alumno está "Pendiente" y
todavía no tiene usuario, en vez del link genérico de "Crear usuario y contraseña" aparece un
botón **"Aprobar y crear acceso"** que hace las tres cosas de una: genera usuario/contraseña,
activa al alumno (`activo=true, pendiente=false`), y muestra el resultado en el mismo recuadro
verde que ya existía (con el botón de enviar por WhatsApp, que automáticamente incluye la
contraseña porque usa el mismo estado `creado`). El profesor lo puede cambiar después con
"Cambiar contraseña" si quiere otro. El Badge de "Pendiente"/"Activo" de arriba de la ficha se
actualiza solo, sin recargar -- `onCambiado` pasó de recibir solo el usuario a recibir un objeto
parcial (`{ usuario, activo, pendiente }`) que el padre mezcla en su estado.

**`AlumnosPage.jsx` (lista):** el botón "Activar" (que antes activaba ahí mismo sin crear acceso)
ahora es un link **"Revisar y activar"** que lleva a la ficha -- mostrar las credenciales y el
botón de WhatsApp en una fila de tabla no tiene sentido, y ya está resuelto en la ficha; mejor un
solo lugar que duplicarlo.

**Verificado sin tocar ningún alumno real**, con un alumno de prueba insertado y borrado en la
misma sesión: la RPC real (`crear_acceso_alumno` + `UPDATE activo/pendiente`) deja al alumno
"activo", con usuario armado bien desde el nombre ("José Prueba Aprobar" -> `jose`, sin acento) y
login correcto. Colisión de usuario probada aparte con dos alumnos de nombre parecido: el segundo
choca contra `crear_acceso_alumno()` con el mismo mensaje que ya usaba esa función, y el reintento
con el número siguiente (`jose2`) funciona.

### 09/09/2026 — "Eliminar alumno no se elimina", pre-cargar el cobro y foto/video invisible para los alumnos

Tanda grande, cuatro pedidos/bugs en un mismo mensaje de Nalux.

**1. "Cuando quiero eliminar un alumno no se elimina".** El DELETE en sí funciona perfecto a nivel
de base -- probado dentro de una transacción con `ROLLBACK`, simulando la sesión real de un
profesor, con pagos y asistencias reales colgando del alumno (cascada completa, `ROLLBACK`
después, nada tocado de verdad). El problema estaba en el cliente: el `window.confirm()` agregado
horas antes (ver la entrada de la revisión de Alumnos) era el único cartel de confirmación **nativo
del navegador** de toda esta pantalla -- el resto de la app usa el patrón "¿Seguro? / Sí /
Cancelar" inline -- y encima no tenía manejo de error: si algo fallaba, quedaba mudo, sin avisar
nada. Se unificó con el mismo patrón inline que ya usa el resto de la app (confirmación por fila,
con `confirmandoBorrarId`), y ahora si el borrado falla de verdad se ve en un `ErrorBox`.

**2. Pre-cargar el cobro con el plan que el alumno ya tiene asignado.** *"cada vez que abro algún
modal para cobrarle tengo que rellenar todo de nuevo... ya tienen que quedar asentado el plan,
cubre desde y cubre hasta"*. Ya existía `aplicarPlan()` (se dispara al elegir un plan a mano en el
modal), pero `abrirCobro()` nunca lo llamaba solo -- el profesor tenía que re-elegir el plan cada
vez, aunque el alumno ya lo tuviera guardado desde que se lo dio de alta. Ahora `abrirCobro()`:
- Si el alumno tiene `plan_precio_nombre`, llama a `aplicarPlan()` de una, precargando monto,
  descuento, interés y el período que cubre.
- **"Cubre desde" ya no es siempre hoy**: si hay un pago anterior, arranca al día siguiente de
  donde terminó ese pago (`periodo_hasta + 1 día`), para que dos cuotas seguidas no se pisen ni
  dejen un hueco sin cubrir. `aplicarPlan()` se ajustó para aceptar esa fecha explícita en vez de
  leerla siempre de `form.periodo_desde` -- llamarla en el mismo tick que `setForm()` hubiera leído
  el valor viejo, porque React no actualiza el estado en el medio del mismo evento.
- Como la ficha del alumno y el módulo de Pagos ya comparten el mismo modal (`?alumno=id`), el
  arreglo cubre los dos casos de una -- no hizo falta tocar nada aparte para "ya sea si cobro desde
  la ficha del alumno o en el módulo de pagos y caja".
- Verificado con una simulación en Node de la misma lógica (plan real + un pago anterior): el
  período, el monto y los porcentajes salen exactamente como debe.

**3. El botón "Cobrar" junto al estado de cuota, visible sin importar la pestaña.** Antes "Estado
de cuota" (con el botón, que pasó de decir "Registrar pago" a "Cobrar") vivía adentro de la
pestaña "Pagos" de la ficha -- si el profesor llegaba por otro lado (por ejemplo desde la lista de
Alumnos) no lo veía sin entrar a esa pestaña. Se sacó a un componente aparte
(`EstadoCuotaAlumno`), montado siempre arriba de las pestañas, igual que "Acceso del alumno". Con
borde y letra en rojo cuando la cuota está vencida o con deuda, para que se note a simple vista.

**4. "A los alumnos no se ve la imagen o video del ejercicio" -- bug crítico, migración 0041.**
`ver_plan_por_codigo()` (la RPC que arma el plan del alumno) buscaba la foto/video de cada
ejercicio con `WHERE e.gimnasio_id = v_gimnasio_id` -- **nunca matcheaba un ejercicio de la
biblioteca base** (`gimnasio_id IS NULL`, compartida entre todos los gimnasios). Contado antes del
fix: **500 ejercicios de la biblioteca base tienen media cargada, contra apenas 4 propios por
gimnasio** -- para casi cualquier rutina armada con la biblioteca, el alumno recibía `mediaUrl`
vacío aunque el profesor lo viera perfecto al armar la rutina (esa pantalla no tiene este filtro).
Arreglo: el `WHERE` acepta el ejercicio propio del gimnasio O uno de la biblioteca base, mismo
criterio que ya usan las pantallas normales de Ejercicios/Rutinas. **Verificado con datos reales,
antes y después, sobre la misma rutina real de un alumno: de 2 sobre 18 ejercicios con media, a 18
sobre 18** -- y confirmado además visualmente en el navegador (`/mi-plan/:codigo`, sin sesión):
los botones "Ver ... / Ver cómo se hace" que antes no aparecían ahora están en los 18 ejercicios.

Build de producción limpio (871 KB el bundle principal). Nada de esto tocó ningún alumno ni pago
real -- las pruebas de la 1 y la 2 fueron simulaciones (transacción con `ROLLBACK` o cálculo en
Node); la de la 4 se verificó contra datos reales de gimnasios reales, pero solo leyendo (ninguna
escritura).

### 09/09/2026 — "Con deuda" pasa a depender de la fecha, no solo del saldo

Nalux, probando en vivo la tanda anterior: "Alumno 1 Nadia" (Mi GYM FIT) aparecía "Con deuda"
aunque su período pagado cubre hasta el 04/10 -- un mes después de la fecha de hoy. Su duda:
*"tendría que ser pasada esa fecha, si no paga se le asigna con deuda"*.

**Investigado antes de cambiar nada:** el pago en cuestión era del 04/09, método "Sin cobrar",
$0 cobrados, $30.000 marcados como adeudados, cubriendo hasta el 04/10 -- la opción de
"activación sin cobrar" del modal de Pagos. Confirmado con Nalux que era una prueba vieja, no una
alumna real debiendo plata; se borró ese pago (tenía comprobante N.º 2 asignado -- queda un salto
en la numeración, esperable al borrar algo que nunca debió tener número).

**La regla en sí también se confirmó que había que cambiarla.** `estadoCuota()`
(`lib/format.js`) hacía ganar "Con deuda" sobre cualquier otra cosa apenas hubiera
`monto_adeudado > 0`, sin mirar si el período seguía vigente -- a propósito, según el comentario
viejo ("alguien puede tener el período al día y aun así deber plata"). Nalux prefirió que, mientras
el período pagado en parte siga vigente, se vea igual que cualquier otro ("Al día"/"Próximo") -- la
deuda recién pasa a ser el ESTADO mostrado una vez que ya venció `periodo_hasta` (esté o no todavía
en el plazo de gracia) y sigue sin saldarse. El monto en sí (`monto_adeudado`) sigue visible aparte
en el "Debe $X" de cada fila, en Pagos y en la ficha, sin importar el estado -- no se esconde nada,
solo cambió cuál badge gana.

**Efecto secundario real, encontrado al revisar quién más usa `estadoCuota()`:** la baja
automática de alumnos (`AppLayout.jsx`, política "dar de baja", migración 0020) da de baja a
cualquiera en estado `vencido` **o** `con_deuda` -- con la regla vieja, una alumna cubierta hasta
el mes que viene pero con saldo cargado se daba de baja igual, de una, sin haber llegado siquiera
a la fecha de vencimiento. Con el arreglo, eso ya no pasa: recién se la da de baja si de verdad
venció y sigue debiendo.

**A propósito NO se tocó** `segmentoNotificacion()` (audiencia de Avisos) ni el `v_segmento` de
`ver_plan_por_codigo()` en SQL -- están documentadas como deliberadamente distintas de
`estadoCuota()`, espejadas entre sí para que el contador "X/Y leyeron" no mienta. Cambiar
`estadoCuota()` no las afecta.

**Verificado con una simulación en Node** de la función completa, los 5 casos: deuda + período
vigente -> "al_dia" (el cambio pedido); deuda + ya vencido -> "con_deuda"; deuda + vencido pero en
gracia -> "con_deuda"; sin deuda + vigente -> "al_dia" (sin cambios); sin deuda + vencido ->
"vencido" (sin cambios). Build de producción limpio.

### Por qué esta entrada existe

Al ir a implementar el seguimiento físico con medidas de pierna y cadera, **resultó que ya estaba
hecho desde el 04/09** — igual que el gráfico de ingresos y el PDF de alimentación. El plan que
había guardado los daba por pendientes porque se escribió antes y nunca se actualizó. Se detectó
a tiempo sólo por revisar la base de datos antes de escribir código.

Por eso Nalux pidió (07/09/2026) que **cada cambio se anote acá en la misma tanda de trabajo**.
CONTEXT.md es lo único que sobrevive entre sesiones: si queda viejo, se planifica sobre
información falsa y se rehace trabajo ya hecho.
