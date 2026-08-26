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

**Es un SaaS multi-tenant real, no un sistema a medida de un solo cliente**, aunque el modelo
de negocio final (¿Kairox se lo vende a un gimnasio o a varios?) todavía es una decisión
abierta — ver sección 5. Técnicamente ya está armado como multi-tenant desde el día uno,
sea cual sea esa decisión:

- **Nivel 1 de aislamiento (ya implementado, verificado contra la base real):** cada gimnasio
  es un tenant identificado por `gimnasio_id`. Ningún gimnasio puede ver ni un solo dato de
  otro — ni por accidente, ni por un bug del frontend, porque el aislamiento vive en la base
  de datos (Row Level Security de Postgres), no solo en el código.
- **Nivel 2 de aislamiento (Fase 2, todavía no construido):** dentro de un mismo gimnasio,
  cuando el alumno tenga login propio, un alumno tampoco va a poder ver los datos de otro
  alumno del mismo gimnasio — solo los suyos.

**Origen:** exportado desde Hostinger Horizons con backend PocketBase. Se está migrando a
Supabase (ver sección 2). El PocketBase viejo **no se toca** — convive hasta que la migración
esté probada de punta a punta. **Nota:** el código de `apps/pocketbase` no existe en este
checkout local (solo aparece referenciado en `.gitignore`, previendo que se agregue) —
pendiente confirmar con Nalux si hace falta recuperarlo de algún lado o si ya se puede dar de
baja directamente.

**Repo:** `github.com/kairoxia-info/gimnasio-gestion-app` (privado, cuenta personal de Nalux).

**Nombre de la app (temporal, hasta definir el nombre final):** "Gestión GYM Kairox IA". Ya
reemplazó a "Fitness Gym Place" (el nombre de otro gimnasio real, que venía hardcodeado desde
la exportación de Horizons) en todos los `<title>`/`<meta>`/logo de `apps/web`.

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

---

## 5. Qué falta / próximos pasos

El plan completo, con checklist paso a paso por bloque (A a G) y las preguntas todavía
abiertas para definir con Nalux, está en **[`PLAN.md`](PLAN.md)**. Con esto, **toda la Fase 1
(Bloques A-F) está terminada** — el MVP vendible según el plan original. Lo que sigue:

1. **Bloque G** (post-MVP), en curso ítem por ítem — ver historial para el detalle de cada uno:
   - ~~G1. Biblioteca de rutinas reutilizables + asignación masiva~~ **hecho** (26/08/2026).
   - G2. Login de alumno + policies de fila (Nivel 2 de aislamiento).
   - G3. `cargas_ejercicio` + vista de "última carga" del alumno.
   - G4. Récords automáticos.
   - G5. Cronómetro + calculadora de 1RM.
   - G6. Notificaciones segmentadas.
   - G7-G9: gatillados por decisiones de negocio todavía sin resolver (ver preguntas abiertas
     abajo) — no arrancar sin resolver esas antes.
2. **Pendiente de seguridad, antes de sumar staff que no sea de confianza (y OBLIGATORIO antes de
   construir cualquier feature de "invitar staff a mi gimnasio"):** el trigger `BEFORE UPDATE`
   sobre `profiles` de la Decisión 6, y reactivar "Confirm email" (Decisión 17) antes de
   producción. Ver Decisión 18 — el Bloque E subió la prioridad real de este gap: hoy mismo
   permite que cualquier staff se autoasigne `admin` de su propio gimnasio (ya lo permitía antes),
   pero **desde el Bloque E** eso además le da permiso a invalidar el código de invitación real
   del gimnasio (`regenerar_codigo_invitacion()`) sin ser el admin real.

**Preguntas todavía sin responder con el cliente** (no bloquean el Bloque A, pero sí bloquean
partes de Fase 2/3): ¿reservas/turnos?, ¿uno o varios gimnasios clientes?, ¿sedes múltiples?,
¿comprobante manual o carga directa? Lista completa en `PLAN.md`, sección "Preguntas abiertas".

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
