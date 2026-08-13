# Gimnasio Gestión — Contexto del proyecto

> Si sos nuevo acá (Luciano, esto es para vos): leé este archivo entero antes de tocar código.
> Es la referencia de "qué es esto, cómo está armado y por dónde seguir" — no hace falta que
> nadie te lo explique de cero. El detalle profundo de research y planificación está en
> [`PLAN.md`](PLAN.md); este archivo es el resumen vivo del estado real.

---

## 1. Qué es el proyecto

App de gestión para gimnasios: alumnos, rutinas de entrenamiento, planes de alimentación,
asistencia, cuotas/pagos y (a futuro) portal propio para el alumno.

**Es un SaaS multi-tenant real, no un sistema a medida de un solo cliente**, aunque el modelo
de negocio final (¿Kairox se lo vende a un gimnasio o a varios?) todavía es una decisión
abierta — ver sección 4. Técnicamente ya está armado como multi-tenant desde el día uno,
sea cual sea esa decisión:

- **Nivel 1 de aislamiento (ya implementado en el schema):** cada gimnasio es un tenant
  identificado por `gimnasio_id`. Ningún gimnasio puede ver ni un solo dato de otro.
- **Nivel 2 de aislamiento (Fase 2, todavía no construido):** dentro de un mismo gimnasio,
  cuando el alumno tenga login propio, un alumno tampoco va a poder ver los datos de otro
  alumno del mismo gimnasio — solo los suyos.

**Origen:** exportado desde Hostinger Horizons con backend PocketBase. Se está migrando a
Supabase (ver sección 2). El PocketBase viejo **no se toca** — convive hasta que la migración
esté probada de punta a punta.

**Repo:** `github.com/kairoxia-info/gimnasio-gestion-app` (privado, cuenta personal de Nalux).

---

## 2. Stack y arquitectura

**Monorepo** (`npm workspaces`, ver `package.json` raíz):
- `apps/web` — React 18 + Vite 7 + Tailwind 3 + shadcn/ui (~60 componentes en
  `src/components/ui/`) + react-router 7 + recharts + framer-motion.
- `apps/pocketbase` — backend viejo. **Nota:** no existe en este checkout local (solo en el
  `.gitignore`, previendo que se agregue) — pendiente confirmar con Nalux si hace falta
  recuperarlo de algún lado o si ya se puede dar de baja directamente.

**Backend:** migrando de PocketBase a **Supabase** (Postgres + Auth + RLS + Storage).
Proyecto Supabase ya creado (URL y clave pública en `apps/web/.env.local`, no versionado —
ver sección 6).

### Patrón multi-tenant (mismo patrón que Kairox Gestión, renombrado a este dominio)

- **`gimnasios`** — tabla raíz, un registro por tenant. (Se llama `gimnasios`, no `empresas`,
  a propósito — ver Decisión en sección 4).
- **`profiles`** — staff del gimnasio (dueño/entrenadores), vinculado 1:1 a `auth.users`, con
  `gimnasio_id` y `role` (`admin`/`staff`).
- **`get_mi_gimnasio_id()`** — función `SECURITY DEFINER` que devuelve el `gimnasio_id` del
  usuario autenticado. Existe específicamente para romper la recursión de RLS que se produce
  si `profiles` intentara resolver su propio `gimnasio_id` con un sub-SELECT contra sí misma
  (error `42P17`).
- **Policy repetida en las 9 tablas de negocio** (`alumnos`, `ejercicios`, `alimentos`,
  `planes_entrenamiento`, `planes_alimentacion`, `asistencias`, `progreso`, `pagos`,
  `configuracion_precios`): `FOR ALL USING (gimnasio_id = get_mi_gimnasio_id())`.
- **`create_gimnasio()`** — RPC de alta de gimnasio nuevo: crea el registro en `gimnasios`,
  vincula el `profile` del usuario que se registró y lo marca `admin`.
- **Regla de oro, no negociable:** el frontend **nunca** manda `gimnasio_id` en el body de un
  request. Siempre se deriva del JWT vía RLS. Mandarlo desde el cliente sería confiar en el
  cliente para su propio aislamiento — inútil como control de seguridad.

Detalle completo del schema SQL: `schema-supabase-gimnasio.md` (fuente original) y `PLAN.md`
(con los ajustes y campos agregados durante el research).

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

**En progreso ahora mismo:** Bloque A del plan (migración de base de datos — schema, RLS,
`get_mi_gimnasio_id()`, `create_gimnasio()`), con `database-architect` diseñando/revisando la
migración y `appsec-secure-coding` auditando las policies después de aplicarlas.

**Falta todo lo demás:** capa de datos del frontend contra Supabase (Bloque B), auth y rutas
protegidas (Bloque C), identidad de marca por gimnasio (Bloque E), autorregistro por código/QR
y subida de video propio (Bloques E/F), y todo lo de Fase 2/3 (rutinas-plantilla, login de
alumno, récords, notificaciones, finanzas, reservas, etc.). El checklist completo, bloque por
bloque, está en `PLAN.md` sección 3.5 — no se duplica acá para no tener dos fuentes de verdad
desincronizándose.

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
   Gym) demostró que el modelo correcto es plantilla → asignación masiva. Recomendación
   documentada en `PLAN.md` (Decisión 1, opción b) — **a confirmar formalmente al escribir la
   migración en A2**, no cerrada todavía en piedra.
5. **Código de invitación + QR: campo simple en `gimnasios` (`codigo_invitacion`), no una
   tabla `invitaciones` aparte.** Para el MVP alcanza con un código por gimnasio, sin
   expiración ni límite de usos. Migrar a una tabla dedicada más adelante (si aparecen sedes
   múltiples o códigos temporales) es aditivo, no rompe nada existente.
6. **Comprobantes: carga directa del profesor vs. aprobación manual del alumno — decisión
   pendiente, no se implementan los dos.** Son dos formas alternativas de registrar el mismo
   hecho de negocio ("el alumno pagó"). Por ahora el plan sigue con carga directa del profesor.
7. **Duración de rutinas variable desde el arranque**, no fija a 4 semanas como impone la
   referencia — es más barato hacerlo bien ahora que migrar después.
8. **Video de ejercicios: se suma subida de archivo propio a Supabase Storage.** Se descartó
   replicar la videoteca de 1312 videos licenciados de la competencia (eso es producción de
   contenido, no software) — pero subir el propio video del entrenador es barato porque
   Storage ya lo resuelve de fábrica.
9. **Nunca credenciales hardcodeadas en el código.** Ya hubo un caso real (login demo con
   usuario/contraseña fijos en `AuthContext.jsx`) corregido moviéndolo a variables de entorno.
10. **`apps/pocketbase` no se toca** hasta que la migración a Supabase esté probada de punta a
    punta y confirmada. Ni siquiera para "prolijidad" — se sube tal cual está.

---

## 5. Qué falta / próximos pasos

El plan completo, con checklist paso a paso por bloque (A a G) y las preguntas todavía
abiertas para definir con Nalux, está en **[`PLAN.md`](PLAN.md)**. Resumen de por dónde sigue
esto apenas termine el Bloque A:

1. **Bloque B** — capa de datos del frontend (`supabaseClient.js`, reescribir `data.js` y
   `AuthContext.jsx` contra Supabase, sin tocar la firma de `listAll`/`createRec`/etc.).
2. **Bloque C** — auth y rutas: declarar `/login` (hoy no existe), usar `ProtectedRoute` de
   verdad (hoy es un no-op), flujo de registro completo.
3. **Bloque D** — verificar el MVP de punta a punta con dos gimnasios de prueba, confirmando
   que uno no ve nada del otro.
4. **Bloque E** — identidad de marca por gimnasio + autorregistro por código/QR.
5. **Bloque F** — subida de video propio a Supabase Storage.
6. **Bloque G** (post-MVP) — rutinas-plantilla, login de alumno, récords, notificaciones.

**Preguntas todavía sin responder con el cliente** (no bloquean el Bloque A, pero sí bloquean
partes de Fase 2/3): ¿reservas/turnos?, ¿uno o varios gimnasios clientes?, ¿sedes múltiples?,
¿comprobante manual o carga directa? Lista completa en `PLAN.md`, sección "Preguntas abiertas".

---

## 6. Cómo levantar el proyecto en local

**Requisitos:** Node en la versión de `.nvmrc`, npm.

```bash
npm install          # en la raíz — instala los workspaces (apps/web, apps/pocketbase)
```

**Variables de entorno** — crear `apps/web/.env.local` (no se versiona, cada persona necesita
el suyo; pedir los valores reales al equipo, nunca commitearlos):

```
VITE_SUPABASE_URL=<url del proyecto Supabase>
VITE_SUPABASE_PUBLISHABLE_KEY=<clave publishable/anon del proyecto>
```

Importante: Vite solo lee `.env*` desde `apps/web/` (donde vive `vite.config.js`), **no** desde
la raíz del monorepo — un `.env.local` puesto en la raíz no lo va a leer nadie.

**Supabase:** no hay stack local (no se usa `supabase start` ni CLI local) — se trabaja
directo contra el proyecto remoto ya creado. Para tener acceso, pedirle a Nalux que invite tu
usuario al proyecto de Supabase.

**Comandos** (desde la raíz):
```bash
npm run dev     # levanta apps/web (puerto 3000) + apps/pocketbase en paralelo
npm run build   # build de apps/web a dist/apps/web
npm run lint    # eslint de apps/web
```

---

## Historial de actualizaciones

**13/08/2026** — Creación de este documento (Claude, a pedido de Nalux). Estado al momento de
crearlo: `PLAN.md` aprobado, proyecto de Supabase creado, `.env.local` configurado, arrancando
Bloque A con `database-architect` (A2-A7) y `appsec-secure-coding` (revisión de RLS post-A5).
