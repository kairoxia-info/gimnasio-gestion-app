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

**Storage (Bloque E, parcial):** bucket `gimnasio-logos` (público para lectura, escritura solo
admin del propio gimnasio, nombre de archivo anclado a `{gimnasio_id}/logo.<ext>`) —
`supabase/migrations/0003_gimnasio_logos_storage.sql`. Mismo principio de aislamiento que las
tablas, pero ojo: `storage.objects`/`storage.buckets` son tablas **únicas y compartidas por
todos los buckets del proyecto** — el control de acceso ahí es 100% vía RLS con
`bucket_id = '...'` en cada policy, **nunca** vía `GRANT`/`REVOKE` de tabla como en `0002`
(revocarle algo a `storage.objects` completo rompería todos los buckets, no solo uno).

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
- **✅ Bloque E — parcial.** Onboarding del gimnasio nuevo (nombre + logo opcional) y el bucket
  `gimnasio-logos` YA están. **Todavía NO están**: código de invitación/QR (Decisión 7, ni
  siquiera empezado) ni una pantalla de Configuración para que un admin ya onboardeado edite
  después el nombre/logo/color de su gimnasio (hoy esos datos solo se cargan una vez, en el
  onboarding — no hay UI para volver a editarlos).
- **Verificado contra la base real, no simulado:** signup → confirmación → login → onboarding →
  panel, con dos cuentas reales distintas; aislamiento entre tenants con el código real
  (alumnos, gimnasios y profiles ajenos no visibles entre sí); Storage — subida propia OK,
  subida cruzada a otro gimnasio rechazada, nombre de archivo fuera de patrón rechazado, lectura
  pública OK; contraste claro/oscuro verificado con estilos computados. Detalle en el historial.

**⚠️ Lección operativa de esta sesión — cuentas de prueba:** `supabase.auth.signUp()` manda el
mail de confirmación de verdad apenas se llama, así que probar con emails inventados
(`@example.com` o similares) hace que Supabase reciba rebotes reales — con suficientes, puede
restringir el envío de mails del proyecto. **Para probar signup/login de acá en adelante, usar
una cuenta con un email real (o pedirle a Nalux que lo haga él), nunca inventar direcciones.**

**Falta:** resto de la capa de datos del frontend contra Supabase (Bloque B — hoy solo está
migrada la parte de auth; `data.js` y las páginas de negocio como `AlumnosPage`, `EjerciciosPage`,
etc. siguen hablando con PocketBase), verificación de punta a punta desde la UI con datos de
negocio reales (Bloque D), lo que falta de Bloque E (código/QR, pantalla de configuración de
marca), subida de video propio (Bloque F), y todo lo de Fase 2/3 (rutinas-plantilla como feature
de UI, login de alumno, récords, notificaciones, finanzas, reservas, etc.). El checklist
completo, bloque por bloque, está en `PLAN.md` sección 3.5 — no se duplica acá para no tener dos
fuentes de verdad desincronizándose.

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

---

## 5. Qué falta / próximos pasos

El plan completo, con checklist paso a paso por bloque (A a G) y las preguntas todavía
abiertas para definir con Nalux, está en **[`PLAN.md`](PLAN.md)**. Resumen de por dónde sigue
esto ahora que terminó el Bloque A:

1. **Bloque B** — capa de datos del frontend (`supabaseClient.js`, reescribir `data.js` y
   `AuthContext.jsx` contra Supabase, sin tocar la firma de `listAll`/`createRec`/etc.;
   renombrar campos relacionales como `alumno` → `alumno_id`).
2. **Bloque C** — auth y rutas: declarar `/login` (hoy no existe), usar `ProtectedRoute` de
   verdad (hoy es un no-op), flujo de registro completo (`signup` → `create_gimnasio()`).
3. **Bloque D** — verificar el MVP de punta a punta **desde la UI** con un gimnasio nuevo real
   (no simulado por SQL como en A6).
4. **Bloque E** — identidad de marca por gimnasio + autorregistro por código/QR (Decisión 7).
5. **Bloque F** — subida de video propio a Supabase Storage (Decisión 10).
6. **Bloque G** (post-MVP) — UI de rutinas-plantilla, login de alumno, récords, notificaciones.

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
