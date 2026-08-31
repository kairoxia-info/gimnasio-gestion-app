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
   - G6. Notificaciones segmentadas.
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
