# Plan de implementación — App de gestión de gimnasios

> Documento de research y planificación. **No se implementó nada todavía.**
> Fecha: 11/08/2026 · **Actualizado: 13/08/2026** (hallazgos de una segunda app de referencia)
> Fuentes: (1) exploración de la app de referencia `gestiongym.shop` con cuentas demo profesor y alumno, (2) revisión del código actual en `apps/web`, (3) schema de Supabase provisto (`schema-supabase-gimnasio.md`), (4) hallazgos de una segunda app de referencia (Ultra Gym / Control Gym), aportados por el cliente — ver PARTE 1.B.

---

## PARTE 1 — La app de referencia (Gestión Gym)

Aplicación PHP multi-tenant, ya en producción, con dos roles bien diferenciados. El menú del profesor tiene 7 grupos: Principal, Entrenamiento, Administración, Tienda, Comunicación, Mi Gimnasio, Configuración. La demo tiene varios módulos bloqueados ("Función Pro" / "Demo protegido"), pero se pueden ver las pantallas.

### 1.1 Panel principal (profesor)

`home_accesos.php` — "Panel rápido / Hola, profe". Un **Resumen del día** en formato de lista de frases, no de tarjetas numéricas:
- "Hoy ingresaron **0 alumnos**"
- "Se cobraron **$0**: 0 cuotas y 0 ventas"
- "Hay **0 cuotas vencidas** y 0 vencen en los próximos cinco días"
- "No hay cumpleaños cargados para hoy"

**Detalle de diseño:** el resumen está redactado en lenguaje natural con los números en negrita, en vez de KPIs sueltos. Se lee como un parte diario. Es más cálido y más accionable que una grilla de números.

**Destacable:** el aviso de **cumpleaños del día**. Es un detalle de retención de clientes que casi ningún sistema de gestión trae de fábrica.

### 1.2 Entrenamiento → Gestión de Rutinas ⭐ (el módulo más fuerte)

`gestion_rutinas.php`. Es el corazón de la app y donde está la mayor distancia respecto a lo que tenemos.

**Listado:** 224 rutinas, con buscador, paginación (10/25/50 por página) e ID visible por rutina. Cada rutina tiene 7 acciones:
`ARMAR RUTINA` · `EDITAR` · `ASIGNACIÓN MASIVA` · `ACTUALIZAR ALUMNOS` · `EXPORTAR PDF` · `DUPLICAR` · `ELIMINAR`

**Concepto clave: la rutina es una plantilla reutilizable, no una propiedad del alumno.** Se arma una vez y se asigna a N alumnos. `DUPLICAR` permite versionar (se ve una rutina "6 días (frecuencia3 en piernas)" y su "(Mes 2)"). `ACTUALIZAR ALUMNOS` propaga cambios de la plantilla a quienes ya la tienen asignada.

**Armador de rutina (modal):**
- **Modo de planificación**, se elige entre dos:
  - *Por semanas* — "ideal si la rutina cambia semana a semana o trabajás con progresiones planificadas"
  - *Rutina fija* — "ideal si el alumno repite la misma estructura durante varias semanas". Internamente se guarda como Semana 1 para no romper la estructura; el alumno no ve el selector de semanas.
- Duración fija de **4 semanas**.
- Estructura: **Rutina → Semana (1-4) → Día (Lunes-Domingo) → Bloque → Ejercicio**.
- **Bloques**: es una capa de agrupación *dentro* del día, con nombre libre. La demo tiene ~60 bloques definidos: "Movilidad articular", "Activación", "Bloque 1..5", "Entrada en calor", "Zona media", "Pecho-Triceps", "contraste 1/2/3", "amrap", "emom", "hiit", "pliometria", "Protocolo FST-7", "Bloque super serie", etc. Se pueden filtrar los ejercicios del día por bloque (chips "VER BLOQUES: TODOS / ACTIVACIÓN / BLOQUE 1...").
- Cada ejercicio dentro del día tiene: número de orden (con botón `ORDENAR`), selector de **clasificación** (Bíceps, Cardio, Dominante de cadera, Core, Empuje horizontal, Tracción vertical, Dominante de tobillo, Gemelos, Cuádriceps, Compuesto…), selector de ejercicio filtrado por esa clasificación, y los campos:
  **Series · Repeticiones · Descanso · Intensidad · Peso sugerido · Comentario del profesor**
- Botones por ejercicio: `IMAGEN + VIDEO`, `VER VIDEO`, **`✨ ASISTENTE IA`**.
- Además de la planificación, cada rutina puede tener un **WOD / Actividad** opcional adjunto (formato CrossFit).

**Destacables:** el modelo plantilla + asignación masiva + propagación de cambios; los bloques con nombre libre; la clasificación de ejercicios por patrón de movimiento (empuje/tracción/dominante de rodilla/cadera) además de por grupo muscular; y el `Comentario del profesor` por ejercicio.

### 1.3 Entrenamiento → Ejercicios

`gestion_ejercicios.php`. Catálogo de **230 ejercicios** propios del gimnasio. Buscador, filtro por grupo y filtro por **Origen** ("Todos los ejercicios" / propios / globales). Cada ejercicio tiene imagen, nombre, descripción técnica larga, tag de grupo muscular, badge `Global` y flag "Video disponible".

**Destacable:** la distinción **ejercicio global (del sistema) vs. propio (del gimnasio)**. El gimnasio hereda un catálogo base y le suma los suyos.

### 1.4 Entrenamiento → Videoteca

`admin_videoteca.php`. **1312 videos** de ejercicios, buscables por nombre o grupo muscular, con opción de guardar el movimiento en la biblioteca propia. Es contenido curado por el proveedor, actualizado "día a día".

**Destacable como diferencial comercial**, pero es un activo de contenido, no de software: implica producir o licenciar 1300 videos.

### 1.5 Entrenamiento → Seguimiento

`profesor_seguimiento.php`. Feed cronológico de **actividad real de los alumnos**:
> 27 de julio de 2026, 14:34:34 — **Ariel Ledesma** — Prensa horizontal unipodal — Peso: **40.00kg** — Reps: **5**

Debajo, buscador de alumnos con "Última carga: <fecha>", y al abrir uno, tabla completa: Fecha · Semana · Día · Ejercicio · Peso · Reps · **Comentario del alumno** ("Me duele el tobillo", "Molestia en la rodilla", "Auch").

**Destacable, y probablemente la función más valiosa de toda la app:** el profesor ve en tiempo real qué levantó cada alumno y qué le dolió, sin preguntarle. Esto valida exactamente la tabla `cargas_ejercicio` de Fase 2 del schema, incluido el campo `sensaciones`.

### 1.6 Administración → Cuotas

`profesor_cuotas.php`. Acciones en la cabecera: Crear alumno · Crear plan · Ver descuentos · Métodos de pago · Crear descuento · Ver planes · Importar alumnos · Reportes · Avisos.

**Tablero de estados en 7 tarjetas:** Vigentes · Por vencer · **Vencen en 5 días** · Vencidos · **Con deuda (pagos incompletos)** · **Sin cuota (sin plan asignado)** · **Deuda total ($)**.

Tabla de alumnos con esos mismos filtros como chips, y por fila: `Cobrar` · `Historial` · `Ver` · `Acceso` · `Eliminar`.

**Modal "Asignar membresía":** Plan (con precio y duración en días: "Musculacion - $30.000 - 30 días") · Descuento (lista predefinida) · **Recargo opcional** · Monto pagado · Método de pago · Fecha de pago · Fecha de vencimiento · Observación · Historial reciente. Tres botones: `Cancelar` · **`Activar sin cobrar`** · `Cobrar y activar`.

**Destacables:**
- **Estado "con deuda" separado de "vencido"** — permite pago parcial: el alumno pagó algo, le queda saldo, y sigue habilitado.
- **`Activar sin cobrar`** — el caso real del alumno que arregla pagar el viernes.
- **Deuda total en pesos** como métrica de cabecera.
- **Importar alumnos** (alta masiva al migrar desde otro sistema o Excel).

### 1.7 Administración → Registro de acceso

`registro_acceso.php`. Pantalla tipo tótem, a pantalla completa, con reloj grande y fecha. El alumno ingresa **por DNI o escaneando un QR** desde su cuenta. Bloqueado en la demo (Plan Pro).

**Destacable:** es control de acceso físico en la puerta, no asistencia cargada a mano por el profesor. Cambia el modelo: la asistencia se registra sola.

### 1.8 Administración → Reservas

`reservas.php` + `reservas_configuracion.php`. Agenda diaria con navegación por fecha. Cada turno es una tarjeta: horario, actividad ("Boxeo"), profesor asignado, **cupo ("0 de 10 lugares ocupados")**, lugares disponibles, **barra de ocupación en %**, estado Abierto/Cerrado, y acciones `Ver alumnos` / `Cerrar`.

**Destacable:** gimnasios con clases por turno (funcional, boxeo, crossfit) lo necesitan sí o sí. Un gimnasio de musculación con entrada libre, no.

### 1.9 Administración → Finanzas

`profesor_finanzas.php`. Ingresos, gastos, rentabilidad. Acciones: Registrar gasto · Nueva categoría · **Gasto recurrente** · Actualizar. Tarjetas: Ingresos del mes (desglosado "Cuotas $105.000 · Tienda $0") · Gastos pagados · **Resultado neto** · **Margen (% de rentabilidad)** · Pendientes · Mayor gasto. Gráfico **Ingresos vs. Gastos de los últimos 6 meses**.

**Destacable:** contabilidad real de doble entrada, no solo caja de cuotas. Los gastos recurrentes (alquiler, luz, sueldos) son lo que convierte "cuánto cobré" en "cuánto gané".

### 1.10 Administración → Reportes

`reportes.php`. Seis informes (bloqueados en demo): Informe de cuotas · Vencimientos · Informe de deudas · Informe de accesos · Seguimiento de asistencias · Informe de alumnos ("activos, sin cuota, sin rutina, inactivos o con información incompleta").

**Destacable:** el informe de alumnos **"sin rutina" / "con información incompleta"** — detecta huecos operativos, no solo métricas.

### 1.11 Tienda

`tienda_productos.php` (nueva venta) · `tienda_stock.php` · `tienda_reportes.php` (historial). Punto de venta de suplementos/bebidas con control de stock, integrado a Finanzas (los ingresos de tienda suman al mes).

### 1.12 Comunicación → Enviar avisos

`profesor_notificaciones_alumnos.php`. Métricas de audiencia arriba (Todos · Vigentes · Por vencer · Vencidos · Con deuda · Sin cuota) y formulario: **Destinatarios** (segmentable: "Todos mis alumnos (1)"), Título, Mensaje. El alumno ve el aviso al ingresar y **queda marcado como leído cuando toca "Entendido"**.

**Destacable:** segmentación por estado de cuota (mandarle solo a los morosos) + acuse de lectura.

### 1.13 Mi Gimnasio → Mi Web

`profesor_pagina_publica.php` → genera `gestiongym.shop/demo`. Landing pública del gimnasio con logo, nombre, "Página oficial del gimnasio", dirección, horarios, botón **"Ingresar como alumno"**, **"Instalar app" (PWA)** y "Consultar por WhatsApp".

**Destacable:** el gimnasio obtiene una web pública sin contratar a nadie, y funciona como puerta de entrada de los alumnos + PWA instalable en el celular.

### 1.14 Mi Gimnasio → TV

`tv_admin.php`. Genera una URL pública (`gestiongym.shop/tv/124`) para abrir en un televisor de recepción o sala, con imágenes y videos promocionales rotando. Bloqueado en demo.

### 1.15 Mi Gimnasio → Roles usuarios

`usuarios_equipo.php`. Usuarios secundarios con permisos. **Función Pro, bloqueada en la demo.** Confirma que el modelo comercial cobra por multi-usuario.

### 1.16 Configuración → Personalización de marca

`profesor_configuracion.php`. Tres secciones:

**Identidad visual:** Nombre comercial · Logo (JPG/PNG/WEBP, máx 2MB) · **Color principal (color picker + hex, `#00d5ff`)** — "se usa en botones, bordes, comprobantes y detalles visuales". Con **vista previa del comprobante en vivo**.

**Comprobantes:** Mostrar logo · **Mostrar deuda en el comprobante** ("si el pago es parcial") · **Texto inferior del comprobante** (máx 255 caracteres, ej. "Este comprobante no es válido como factura"). Numeración correlativa ("Comprobante #12").

**Acceso del alumno** (reglas de negocio configurables por gimnasio):
- Mostrar aviso de cuota al alumno
- **Bloquear rutina si la cuota está vencida**
- **Permitir entrar con deuda**
- Mensaje personalizado cuando la cuota está vencida

**Avisos automáticos de cuotas:** días de anticipación (ej. 3) · avisar también el día del vencimiento · **mensaje con variables `{nombre}`, `{fecha_vencimiento}`, `{plan}`, `{nombre_gimnasio}`**.

**Destacables:** que "¿le corto el acceso al que debe?" sea un **toggle de configuración y no una decisión hardcodeada** es la diferencia entre un producto y un sistema a medida. Cada gimnasio tiene su política. Y el color principal + logo por gimnasio es multi-tenancy visual real.

---

### 1.17 Vista del ALUMNO

Menú reducido a 4 grupos: Principal, Entrenamiento (Rutina, Progreso), Administración (Reservas), Tienda. Diseñada explícitamente para celular (la propia app lo aclara en su modal de bienvenida).

**Inicio** — "¡HOLA, ARIEL!". Dos accesos grandes: `Ver rutina` / `Mi progreso`. Tarjeta **Tu cuota**: estado (Vigente), Plan, Vence, **Deuda ($0)**, "Tu cuota se encuentra activa". Tarjeta **Clases disponibles: 9 de 12**, con barra de progreso, "3 utilizadas", "Vence 11/06/2027".

> **Destacable:** el modelo de **clases por paquete (9 de 12)** además de la cuota por tiempo. Son dos modelos de cobro distintos conviviendo.

**Mi Rutina** (`routines.php`) — "Rutina asignada para Ariel Ledesma", badge "Rutina activa". Selector **Semana 1-4** + selector de **día**. Luego, por día: botón **CALCULADORA** y los **bloques colapsables, cada uno con % de avance y contador "0/5 ejercicios"**.

Cada ejercicio muestra: número de orden, nombre, **estado "Pendiente"**, **imagen ilustrativa**, **botón de video**, Series y Repeticiones prescritas, y una fila con:
- **"Última carga: 4 kg × 8 reps"** ← su propio historial, ahí mismo
- botón de **cronómetro**
- botón de registrar carga

**Cronómetro de descanso:** modal con tiempo configurable (default 01:30), Iniciar/Reiniciar, y **"podés cerrar esta ventana y el cronómetro seguirá funcionando"**.

**Calculadora de cargas:** Peso utilizado (kg) + Repeticiones realizadas → Calcular (estimación de 1RM).

**Mi Progreso** (`progreso.php`) — tabs Semana 1-4 y cuatro métricas: **Cumplimiento semanal (%)** · **Días entrenados (0/5)** · **Ejercicios realizados (0/50)** · **Récords nuevos**. Barra de "Avance general".

**TUS RÉCORDS DE LA SEMANA 🏆** — tarjetas con trofeo:
> **Sentadilla en smith — 90 KG** · "Superaste tu marca anterior por 8 kg" · Marca anterior: 82 kg

**Destacables (los más fuertes de toda la app):**
1. **Los récords automáticos.** El sistema detecta solo cuándo el alumno superó su marca y se lo celebra. Es la función de retención más potente que vi: convierte datos que ya se están cargando en motivación.
2. **"Última carga" en el momento del ejercicio.** El alumno no tiene que acordarse ni abrir otra pantalla: sabe con cuánto viene mientras está parado frente a la máquina.
3. **El cronómetro que sobrevive al cierre del modal.** Detalle chico, uso real constante.
4. El tono del copy: "Todavía no arrancaste. Empezá esta semana y vas a poder seguir tu avance acá."

**Diseño general:** dark mode, acento cian `#00d5ff`, tipografía display condensada en mayúsculas para títulos, tarjetas con bordes redondeados grandes, mucho contraste. Mobile-first en la vista del alumno, desktop en la del profesor.

---

## PARTE 1.B — Segunda app de referencia (Ultra Gym / Control Gym)

Hallazgos aportados por el cliente sobre una segunda app competidora, para completar el research antes de definir el plan final. Se listan con la decisión de dónde entra cada uno (ya conversada y confirmada con el cliente).

### 1.B.1 Autorregistro de alumnos por código de invitación + QR — **suma al MVP (Fase 1, Bloque E)**

El gimnasio tiene un código/QR propio. El alumno lo escanea, se autorregistra y elige el plan que quiere, sin que el entrenador tenga que cargarlo a mano. Encaja directo con el modelo multi-tenant: es, literalmente, la puerta de entrada al `gimnasio_id` correcto sin intervención manual del staff. Detalle de diseño y flujo de pago asociado: ver **Decisión 8** en 3.4.

### 1.B.2 Subida de video propio del entrenador (no la videoteca de contenido) — **suma al MVP (Fase 1)**

Distinto de la videoteca de 1312 videos licenciados de Gestión Gym (esa sigue descartada: es producción de contenido, no software). Acá el entrenador sube **su propio archivo** de video (celular o PC) para un ejercicio, a Supabase Storage. `ejercicios.media_url` ya existe en el schema — hoy `EjerciciosPage` solo acepta pegar una URL externa; falta el control de subida de archivo. Es barato porque Supabase Storage lo resuelve de fábrica (bucket + políticas por `gimnasio_id`); no hay que construir infraestructura de video, solo la UI de carga y la política de acceso. Se mantiene también la opción de pegar una URL externa (YouTube, etc.), que es gratis y ya funciona.

### 1.B.3 Sedes múltiples por gimnasio — **Fase 3, sin asumir**

Un gimnasio con más de una ubicación física, con reportes filtrables por sede. **No se sabe todavía si el cliente lo necesita.** No lo bloqueamos (el modelo `gimnasio_id` como tenant raíz no lo impide: una tabla `sedes` con `gimnasio_id` y un `sede_id` opcional en `alumnos`/`asistencias` se podría sumar después sin romper nada), pero tampoco lo asumimos ni le reservamos campos en el schema del MVP. Se pregunta al cliente cuando corresponda (ver Preguntas abiertas).

### 1.B.4 Comprobantes con aprobación manual — **alternativa al flujo de pagos ya diseñado, decisión pendiente (no implementar ambos)**

El alumno paga por fuera del sistema (transferencia, efectivo en mano, etc.), sube una foto del comprobante desde su cuenta, y el pago queda en estado **"Pendiente"** hasta que el entrenador lo **aprueba o rechaza**. Esto **no es un agregado** al flujo de "Cobrar y activar" / "Activar sin cobrar" que ya diseñamos en 1.6 — es un **modelo alternativo** de registrar el mismo hecho (el alumno pagó). Un gimnasio no necesita los dos: o el profesor carga el pago él mismo (lo que ya está diseñado), o el alumno sube el comprobante y el profesor lo aprueba. Queda anotado como decisión pendiente — ver **Decisión pendiente 9** en 3.4. No se implementa ninguno de los dos hasta resolverla.

### 1.B.5 Faltas con penalización automática configurable — **Fase 3, atada a la decisión de Reservas**

Límite de faltas por mes, horas de bloqueo, minutos de tolerancia, comparando reservas contra check-ins reales. Depende por completo de que el gimnasio use el módulo de Reservas/turnos (1.8), que ya está en Fase 3 sin confirmar. **No se activa si Reservas no se implementa** — no tiene sentido sin el dato de "turno reservado" para comparar contra la asistencia real.

---

## PARTE 2 — Estado actual de nuestro proyecto

### 2.1 Lo que hay

Monorepo `apps/web`: React 18 + Vite 7 + Tailwind 3 + shadcn/ui (~60 componentes en `src/components/ui/`) + react-router 7 + recharts + framer-motion. Backend PocketBase (`src/lib/pocketbaseClient.js`, apuntando a `/hcgi/platform`).

**8 páginas, 9 colecciones:**

| Página | Estado |
|---|---|
| `DashboardPage` | 4 KPIs, caja del mes, lista de morosos, "flujo recomendado" |
| `AlumnosPage` | CRUD completo, búsqueda, foto, observaciones de salud, plan asignado |
| `AlumnoPage` | Ficha con 5 tabs: Entrenamiento · Nutrición · Progreso · Asistencia · Pagos |
| `EjerciciosPage` | CRUD, filtro por grupo muscular, URL de video, descripción |
| `AlimentosPage` | CRUD, tabla con calorías y macros (P/C/G) |
| `AsistenciaPage` | Grilla semanal de todos los alumnos, click cíclico presente/ausente/sin registro |
| `PagosPage` | Caja del mes, estado por alumno, últimos 15 pagos |
| `ConfiguracionPage` | CRUD de planes: precio, período, días/semana, descuento, interés por mora |

La capa de datos es un wrapper delgado y genérico (`listAll` / `createRec` / `updateRec` / `removeRec`), lo que hace que migrar el backend sea barato: **las páginas casi no se tocan**.

### 2.2 Comparación honesta contra la referencia

| Módulo | Nosotros | Gestión Gym | Gap |
|---|---|---|---|
| Biblioteca de ejercicios | ✅ CRUD + grupo + video | ✅ 230 propios + 1312 videos + globales | Contenido, no código |
| Planes de entrenamiento | ⚠️ Plan por alumno, "Día 1-6", JSONB | ✅ Plantilla reutilizable, 4 semanas, bloques, asignación masiva, PDF | **El gap más grande** |
| Vista del alumno | ❌ No existe | ✅ Rutina, progreso, récords, cronómetro | **El segundo gap más grande** |
| Carga por ejercicio | ❌ No existe | ✅ Con comentarios del alumno | Fase 2 del schema |
| Récords | ❌ No existe | ✅ Automáticos con comparación | — |
| Progreso corporal | ✅ Peso/cintura/pecho/brazo + gráfico | ⚠️ No lo vi expuesto así | **Vamos adelante acá** |
| Nutrición | ✅ Alimentos + planes + kcal | ❌ No tiene | **Vamos adelante acá** |
| Asistencia | ✅ Manual (grilla semanal) | ✅ Por DNI/QR en tótem | Distinto enfoque |
| Cuotas | ⚠️ Al día/próximo/vencido | ✅ + con deuda + sin cuota + deuda total + activar sin cobrar | Medio |
| Finanzas | ❌ Solo ingresos | ✅ Gastos, recurrentes, margen, 6 meses | Alto |
| Notificaciones | ❌ No existe | ✅ Segmentadas + acuse | Fase 2 del schema |
| Reservas / turnos | ❌ No existe | ✅ Completo | Alto (si aplica al cliente) |
| Tienda / stock | ❌ No existe | ✅ Completo | Alto |
| Reportes | ❌ No existe | ✅ 6 informes | Medio |
| Marca por gimnasio | ❌ Logo hardcodeado | ✅ Logo + color + comprobantes | **Bloqueante para multi-tenant** |
| Multi-tenant | ❌ **No existe** | ✅ | **Bloqueante** |
| Roles / permisos | ❌ No existe | ✅ (Pro) | Medio |
| Web pública + PWA | ❌ No existe | ✅ | Medio |
| Autorregistro alumno (código/QR) | ❌ No existe | ✅ (Ultra Gym) | **Fase 1 — ver 1.B.1** |
| Video propio subido por el entrenador | ⚠️ Solo URL externa | — (ninguna de las dos referencias lo tiene así) | **Fase 1 — ver 1.B.2** |
| Comprobante con aprobación manual | ❌ No existe | ✅ (Ultra Gym) | Decisión pendiente — ver 1.B.4 |
| Sedes múltiples | ❌ No existe | ✅ (Ultra Gym) | Fase 3, sin confirmar — ver 1.B.3 |
| Faltas con penalización automática | ❌ No existe | ✅ (Ultra Gym) | Fase 3, atado a Reservas — ver 1.B.5 |

### 2.3 Problemas concretos del código actual (a resolver en la migración)

1. **No hay aislamiento multi-tenant.** `createRec` escribe `owner: pb.authStore.record?.id` — aísla por *usuario*, no por gimnasio. Con eso, dos entrenadores del mismo gimnasio no comparten datos y no hay tenant. Es justamente lo que el schema corrige con `gimnasio_id` + RLS.
2. **Las rutas no están protegidas.** En `App.jsx` hay `const guard = (element) => element;` — una función identidad. Existe `ProtectedRoute.jsx` pero **no se usa en ninguna ruta**, y ni siquiera hay ruta `/login` declarada, aunque `AppLayout` y `LoginPage` navegan a `/login`. Hoy la app entra directo al panel.
3. **Marca hardcodeada.** `LOGO_URL` apunta a un CDN de Hostinger y el alt dice "Fitness Gym Place" fijo, en `lib/data.js`. Incompatible con multi-tenant.
4. **Los planes son 1-a-1 con el alumno.** `PlanEntrenamiento` guarda `{alumno, nombre, notas, items}` y la ficha toma `pe[0]`: un plan por alumno, sin reutilización. La referencia demuestra que el modelo correcto es plantilla + asignación.
5. **`data.js` mezcla acceso a datos con helpers de UI** (formato de moneda, fechas, constantes de negocio). Conviene separarlo al migrar.
6. **`AlumnoPage` importa `pb` directamente** (`byAlumno`, `getOne`) salteándose la capa `data.js`. Son los puntos que hay que reescribir sí o sí.
7. **Sin manejo de sesión expirada ni estados de error global.** Los `.catch()` sólo pintan un cartel.

---

## PARTE 3 — El plan

### 3.1 Principio rector

**Primero multi-tenant y auth, después funcionalidad.** Todo lo que se construya antes de tener `gimnasio_id` + RLS habrá que reescribirlo. Y todo lo que se construya sin login real no se puede demostrar a un cliente.

El schema provisto ya resuelve la infraestructura; el trabajo es aplicarlo y hacer que el frontend hable ese idioma.

### 3.2 Orden de prioridades

**FASE 0 — Fundación (bloqueante, nada puede saltearse)**
1. Proyecto Supabase + migración del schema (9 tablas + `profiles` + `gimnasios` + trigger + `get_mi_gimnasio_id()` + `create_gimnasio()`).
2. Verificar RLS activo con la policy correcta en las 9 tablas, sin excepción.
3. `supabaseClient.js` reemplaza a `pocketbaseClient.js`; `data.js` mantiene la misma firma (`listAll`/`createRec`/`updateRec`/`removeRec`) para no tocar las páginas.
4. **Quitar `owner: ownerId()` de `createRec`.** El `gimnasio_id` lo pone un default/trigger en la base o lo deriva RLS — nunca lo manda el cliente. Es la regla de oro del schema.
5. Flujo de registro: signup → trigger crea profile → `create_gimnasio()` → vincula y marca admin.
6. **Arreglar el guard de rutas**: usar `ProtectedRoute` de verdad, declarar la ruta `/login`, manejar sesión expirada.
7. Ajustar los nombres de campo relacionales: hoy el código usa `p.alumno`, y el schema define `alumno_id`. Hay que unificar (recomiendo adoptar `alumno_id` y tocar las páginas, no deformar el schema).

**FASE 1 — Paridad + identidad de marca (lo que hace vendible el MVP)**
8. **Marca por gimnasio**: `gimnasios.logo_url` y `gimnasios.color_principal` ya existen en el schema. Reemplazar `LOGO_URL` hardcodeado, inyectar el color como CSS custom property. Pantalla de configuración del gimnasio.
9. **Estados de cuota completos**: sumar `con_deuda` y `sin_cuota` a los actuales, más "deuda total" en el dashboard. Requiere un campo de monto adeudado o pago parcial en `pagos`.
10. **"Activar sin cobrar"** en el registro de pago.
11. Dashboard: pasar el resumen a lenguaje natural (se lee mejor) y sumar el aviso de cumpleaños (necesita `alumnos.fecha_nacimiento`, que **hoy no está en el schema** — hay que agregarlo).
12. **Autorregistro con código de invitación + QR** (hallazgo Ultra Gym, ver 1.B.1): pantalla pública de alta para el alumno, vinculada al `gimnasio_id` del código escaneado, con selección del plan deseado. La activación final (cobro) se resuelve con el flujo de Cuotas ya diseñado (9-10) hasta que se tome la Decisión pendiente 9 sobre comprobantes.
13. **Subida de video propio en Ejercicios** (hallazgo Ultra Gym, ver 1.B.2): reemplazar el campo de solo-URL por un selector de archivo a Supabase Storage, manteniendo la opción de pegar una URL externa.

**FASE 2 — El diferencial real (donde se gana o se pierde contra la competencia)**
14. **Rutinas como plantilla reutilizable.** Este es el cambio de modelo de datos más importante y hay que decidirlo *antes* de construir la vista del alumno. Ver 3.4.
15. **Login del alumno** (`alumnos.user_id` ya está preparado en el schema) + policies específicas para que el alumno vea solo lo suyo.
16. **`cargas_ejercicio`** (ya diseñada en Fase 2 del schema) + vista del alumno con "última carga" y registro.
17. **Récords automáticos** — se derivan de `cargas_ejercicio`, no necesitan tabla propia (una vista o query con `MAX(peso_usado)` por ejercicio/alumno alcanza).
18. Cronómetro de descanso y calculadora de 1RM (son frontend puro, muy baratos, alto impacto percibido).
19. **`notificaciones`** (ya diseñada) con segmentación por estado de cuota.

**FASE 3 — Expansión (solo si el cliente lo pide, o decisiones pendientes explícitamente resueltas)**
20. Finanzas con gastos y margen. *(sin decidir, nunca se preguntó — no es parte del alcance actual)*
21. Reportes exportables. *(sin decidir, nunca se preguntó — no es parte del alcance actual)*
22. ~~Reservas/turnos.~~ **Descartado (26/08/2026, Decisión 21): el cliente confirmó que no lo necesita.**
23. Tienda/stock. *(sin decidir, nunca se preguntó — no es parte del alcance actual)*
24. Web pública + PWA. *(sin decidir, nunca se preguntó — no es parte del alcance actual)*
25. ~~Sedes múltiples por gimnasio~~ (hallazgo Ultra Gym, ver 1.B.3). **Descartado (26/08/2026,
    Decisión 21): el cliente confirmó una sola sede.**
26. ~~Faltas con penalización automática configurable~~ (hallazgo Ultra Gym, ver 1.B.5).
    **Descartado — dependía de Reservas (22), que también se descartó.**
27. **Comprobante con aprobación manual del alumno** (hallazgo Ultra Gym, ver 1.B.4) — **solo si la Decisión pendiente 9 (3.4) se resuelve a favor de este modelo** en lugar del flujo de "Cobrar y activar" ya diseñado en Fase 1. No se implementan los dos.

### 3.3 Qué sumar de la referencia y qué no

**Sí, sin duda:**
- **Rutina como plantilla reutilizable con asignación masiva** — es *el* diferencial del módulo de entrenamiento. Sin esto, un profesor con 80 alumnos no puede trabajar.
- **Bloques dentro del día** con nombre libre — es cómo los entrenadores realmente piensan una sesión (entrada en calor / activación / bloque principal / accesorios).
- **Carga por ejercicio con comentario del alumno** — cierra el círculo profesor↔alumno. Es lo que hace que el alumno abra la app todos los días.
- **Récords automáticos** — máximo impacto emocional por unidad de esfuerzo técnico: los datos ya están, es una query.
- **"Última carga" junto al ejercicio** — resuelve un dolor real y concreto.
- **Estados de cuota "con deuda" y "sin cuota" + "activar sin cobrar"** — modelan cómo se cobra de verdad en un gimnasio argentino.
- **Personalización de marca (logo + color) y reglas de acceso configurables** — es el requisito para vender el mismo software a N gimnasios.
- **Cronómetro y calculadora** — baratísimos, muy visibles.
- **Campos ricos por ejercicio en la rutina**: intensidad, peso sugerido, descanso, comentario del profesor.
- **Autorregistro con código de invitación + QR** (Ultra Gym, 1.B.1) — elimina la carga manual alumno por alumno y encaja directo con el tenant `gimnasio_id` que ya vamos a tener. Barato de construir sobre la base multi-tenant.
- **Subida de video propio a Supabase Storage** (Ultra Gym, 1.B.2) — distinto de la videoteca licenciada (ver abajo). Barato: Storage lo resuelve de fábrica, solo falta la UI de carga y la política por `gimnasio_id`.

**No, o no todavía:**
- **Videoteca de 1312 videos** — no es un problema de software sino de producción de contenido. Requiere licenciar o filmar. Alternativa razonable: permitir URLs de YouTube (que ya soportamos), subida de video propio del entrenador (ver arriba) y armar un catálogo semilla propio con el tiempo.
- **Asistente IA en el armador** — sin una definición clara de qué resuelve, es un botón lindo que agrega costo por token, latencia y una dependencia. Vale la pena solo cuando esté claro el caso de uso concreto (¿sugerir progresión? ¿autocompletar series/reps?).
- **Tienda/stock** — es un ERP chiquito adentro del producto. Solo si el cliente vende suplementos y lo pide explícitamente.
- **Reservas/turnos** — depende del modelo del gimnasio. Musculación con entrada libre no lo usa. **Preguntarle al cliente antes de invertir acá.**
- **Registro de acceso por DNI/QR en tótem** — requiere hardware, una pantalla dedicada en la puerta y operación distinta. Es un producto aparte. Nuestra asistencia manual cubre el caso básico.
- **Pantalla TV** — nicho, bajo impacto.
- **Duración fija de 4 semanas** — la referencia la impone; me parece una limitación arbitraria, no una virtud. Sugiero permitir duración variable desde el inicio (es más barato hacerlo bien ahora que migrar después).
- **Web pública + PWA** — muy vendible, pero después de que el core funcione.
- **Sedes múltiples** (Ultra Gym, 1.B.3) — Fase 3, sin asumir. No sabemos si el cliente lo necesita; no le reservamos columnas al schema del MVP por las dudas.
- **Faltas con penalización automática** (Ultra Gym, 1.B.5) — Fase 3, y solo si además se implementa Reservas/turnos. Sin reservas, no hay contra qué comparar los check-ins.
- **Comprobante con aprobación manual del alumno** (Ultra Gym, 1.B.4) — no se suma como agregado al flujo de pagos ya diseñado. Es una **alternativa** al mismo hecho de negocio ("el alumno pagó"), así que es una decisión de una sola vía, no una función más. Ver Decisión pendiente 9.

**Lo que nosotros ya tenemos y la referencia no** — vale la pena defenderlo como diferencial propio: **el módulo de nutrición completo** (biblioteca de alimentos con macros + planes por comida + cálculo de kcal) y el **seguimiento de medidas corporales con gráfico de evolución**. No los tiremos en la migración.

### 3.4 Riesgos y decisiones técnicas antes de arrancar

**🔴 DECISIÓN 1 — El modelo de datos de rutinas (la más importante).**
El schema define `planes_entrenamiento` con `alumno_id NOT NULL` y `items JSONB` — o sea, plan por alumno. Pero la referencia demuestra que el modelo correcto es **plantilla → asignación**. Son incompatibles: con `alumno_id NOT NULL` no existe la plantilla sin alumno.

Opciones:
- **(a)** Dejarlo como está para el MVP y migrar después. Riesgo: migrar planes de JSONB a tablas normalizadas con datos reales cargados es doloroso, y hay que reescribir toda la UI del armador.
- **(b) (recomendada)** Separar ahora: `rutinas` (plantilla, sin alumno) + `rutinas_asignadas` (rutina_id, alumno_id, fecha_inicio, activa). Los `items` pueden seguir en JSONB al principio. El costo hoy es bajo; el costo después es alto.

La nota del propio schema sobre normalizar `items` en `plan_items` apunta en la misma dirección: si vamos a querer "qué alumnos tienen tal ejercicio" o récords cruzados, el JSONB estorba. **Mi recomendación: (b), y normalizar `plan_items` en Fase 2, no antes.**

**🟡 RIESGO 2 — RLS y el login del alumno.**
La policy `gimnasio_id = get_mi_gimnasio_id()` funciona perfecto para el staff, pero `get_mi_gimnasio_id()` lee de `profiles`, y el alumno no es staff. Cuando llegue el login del alumno (Fase 2) hay que decidir: ¿el alumno tiene un `profile` con un rol nuevo (`alumno`)? ¿O policies separadas que resuelvan vía `alumnos.user_id = auth.uid()`? **Un alumno no puede ver a los demás alumnos de su gimnasio**, así que la policy de tenant sola no alcanza — necesita una policy de fila propia. Conviene dejarlo pensado ahora aunque se implemente después, porque condiciona el diseño de `profiles`.

**🟡 RIESGO 3 — Nombres de campos entre el código actual y el schema.**
Hoy el frontend usa `alumno`, `owner`, `created`; el schema usa `alumno_id`, `gimnasio_id`, `created_at`. También PocketBase ordena con `sort: '-created'` y Supabase usa `.order('created_at', {ascending:false})`. Es mecánico, pero toca **todas** las páginas. Hay que hacerlo de una sola vez y con cuidado, no a medias.

**🟡 RIESGO 4 — La lección de Kairox Gestión (del propio schema).**
Si `create_gimnasio()` siembra `configuracion_precios` de ejemplo y en algún momento se le agrega un `UNIQUE` parcial, cualquier `ON CONFLICT` debe repetir el mismo predicado. Ya está advertido; hay que respetarlo cuando escribamos la siembra.

**🟡 RIESGO 5 — Campos que faltan en el schema.**
Detecté al menos: `alumnos.fecha_nacimiento` (para cumpleaños), algo de saldo/deuda en `pagos` (para el estado "con deuda"), y `ejercicios` no tiene la distinción global/propio ni la clasificación por patrón de movimiento. Conviene agregarlos en la migración inicial, no después.

**🟢 RIESGO 6 — Alcance.**
La referencia tiene ~20 módulos y años de desarrollo. Intentar igualarla de una es la forma más segura de no terminar nada. El MVP debe ser: **multi-tenant + auth + los 8 módulos actuales funcionando bien + marca configurable.** Recién ahí, rutinas-plantilla y vista del alumno.

**🟢 NOTA 7 — Seguridad.**
El `AuthContext` actual ya quedó limpio de credenciales, pero al migrar a Supabase hay que confirmar que solo se use la **anon/publishable key** en el frontend (nunca la service_role) y que RLS esté activo antes de cargar un solo dato real. Sin RLS, la anon key deja la base abierta.

**🟢 DECISIÓN 8 — Código de invitación: campo en `gimnasios`, no tabla aparte (por ahora).**
Se pidió decidir entre un campo único en `gimnasios` o una tabla `invitaciones` separada. Recomendación: **campo único**, `gimnasios.codigo_invitacion TEXT UNIQUE` (autogenerado por `create_gimnasio()`, regenerable desde Configuración si se filtra) + `gimnasios.autorregistro_activo BOOLEAN DEFAULT true` para poder apagarlo sin borrar el código.

Justificación: para el MVP hay **un** código por gimnasio, sin expiración ni límite de usos ni tracking de quién invitó — justo lo que pide 1.B.1. Una tabla `invitaciones` (con `expira_en`, `usos_maximos`, `creado_por`, y eventualmente `sede_id`) es la evolución natural si en Fase 3 aparecen sedes múltiples (1.B.3) o se necesitan códigos temporales/con límite, pero construirla ahora es resolver un problema que todavía no tenemos. Migrar de un campo a una tabla después es aditivo (no rompe nada existente), así que no hay costo de "elegir mal" ahora.

Nota técnica: el alta por autorregistro necesita una función `SECURITY DEFINER` (`join_gimnasio_por_codigo(codigo, ...)`) análoga a `create_gimnasio()`, porque el usuario nuevo todavía no tiene `profile`/`gimnasio_id` en el momento del signup — mismo patrón que rompe la recursión de RLS ya usado en el schema.

**🟡 DECISIÓN PENDIENTE 9 — Modelo de pagos: carga directa del profesor vs. comprobante con aprobación manual.**
Hoy el plan (1.6, Fase 1) asume que el profesor carga el pago directamente ("Cobrar y activar" / "Activar sin cobrar"). Ultra Gym resuelve el mismo hecho de otra manera: el alumno paga por fuera, sube el comprobante, y queda "Pendiente" hasta que el profesor lo aprueba o rechaza (1.B.4).

**No se implementan los dos modelos.** Es una decisión de producto (¿quién carga la plata: el profesor en el momento, o el alumno con aprobación asincrónica?) que conviene tomar con el cliente antes de tocar el schema de `pagos`, porque un estado "Pendiente de aprobación" con foto adjunta es una rama de flujo distinta (y probablemente un campo `comprobante_url` + `estado IN ('pendiente','aprobado','rechazado')` en `pagos`, o una tabla aparte). Por ahora el plan sigue con el modelo ya diseñado (carga directa); si se opta por el de Ultra Gym más adelante, se reemplaza, no se suma. Ver Preguntas abiertas.

### 3.5 Checklist de pasos concretos, en orden

**⚠️ Nota 31/08/2026: este checklist no se había marcado nunca a medida que se completaban los
bloques — quedaba como si todo siguiera pendiente. Corregido ahora, reflejando el estado real
documentado en el historial de `CONTEXT.md`.**

**Bloque A — Base de datos** ✅ hecho
- [x] A1. Crear el proyecto en Supabase (o confirmar que ya existe) y guardar URL + anon key en `.env.local`.
- [x] A2. Decidir **Decisión 1** (modelo de rutinas) antes de escribir la migración.
- [x] A3. Agregar al schema los campos faltantes detectados (`fecha_nacimiento`, saldo/deuda en `pagos`, origen y clasificación en `ejercicios`).
- [x] A4. Escribir la migración SQL completa: `gimnasios`, `profiles`, trigger `handle_new_user`, `get_mi_gimnasio_id()`, `create_gimnasio()`, las 9 tablas de negocio + índices.
- [x] A5. Habilitar RLS y crear la policy en las 9 tablas.
- [x] A6. **Verificar la aislación con dos gimnasios de prueba**: crear gimnasio A y B, cargar datos en cada uno, confirmar que A no ve nada de B. No dar por buena la RLS sin este test.
- [x] A7. Sembrar datos default en `create_gimnasio()` (planes de ejemplo), respetando la nota de `ON CONFLICT`.

**Bloque B — Capa de datos del frontend** ✅ hecho
- [x] B1. Instalar `@supabase/supabase-js`, quitar `pocketbase` de las dependencias.
- [x] B2. Crear `src/lib/supabaseClient.js` y borrar `pocketbaseClient.js`.
- [x] B3. Reescribir `data.js` manteniendo la firma; **sacar `owner: ownerId()`**; separar helpers de UI a `format.js`.
- [x] B4. Reescribir `AuthContext.jsx` contra Supabase Auth (`signInWithPassword`, `onAuthStateChange`, `signOut`) y exponer también el gimnasio del usuario.
- [x] B5. Renombrar campos relacionales en todas las páginas (`alumno` → `alumno_id`, `created` → `created_at`, sorts).
- [x] B6. Reescribir los accesos directos a `pb` en `AlumnoPage.jsx` (`byAlumno`, `getOne`).

**Bloque C — Auth y rutas** ✅ hecho
- [x] C1. Declarar la ruta `/login` en `App.jsx` (hoy no existe).
- [x] C2. Reemplazar `const guard = (element) => element` por `ProtectedRoute` real.
- [x] C3. Pantalla de registro: signup → `create_gimnasio(nombre)` → redirigir al panel.
- [x] C4. Manejo de sesión expirada y estado de carga inicial (evitar el parpadeo login→panel).

**Bloque D — Verificación del MVP** ✅ hecho
- [x] D1. Probar el flujo completo de punta a punta con un gimnasio nuevo: registro → cargar ejercicios → cargar alumno → armar plan → marcar asistencia → registrar pago.
- [x] D2. Confirmar que el segundo gimnasio arranca vacío y no ve nada del primero.
- [x] D3. `npm run build` sin errores y `npm run lint` limpio.

**Bloque E — Identidad de marca y onboarding del gimnasio (cierra el MVP vendible)** ✅ hecho
- [x] E1. Pantalla de configuración del gimnasio (nombre, logo, color principal).
- [x] E2. Reemplazar `LOGO_URL` hardcodeado por el logo del gimnasio; inyectar `color_principal` como CSS variable.
- [x] E3. Quitar "Fitness Gym Place" de los `<title>`/`<meta>` de las 8 páginas (hoy está fijo en todas).
- [x] E4. Agregar `gimnasios.codigo_invitacion` + `autorregistro_activo` al schema (Decisión 8) y generarlo en `create_gimnasio()`.
- [x] E5. Función `join_gimnasio_por_codigo()` (`SECURITY DEFINER`) + pantalla pública de autorregistro: código/QR → alta del alumno → selección de plan deseado → queda pendiente de activación para el profesor (Cuotas).
- [x] E6. Generar y mostrar el QR del código de invitación en la pantalla de configuración (imagen descargable/imprimible).

**Bloque F — Contenido propio: subir video de ejercicios (Fase 1, hallazgo 1.B.2)** ✅ hecho
- [x] F1. Crear bucket de Supabase Storage para media de ejercicios, con políticas de acceso por `gimnasio_id`.
- [x] F2. UI de subida de archivo en `EjerciciosPage` (selector de archivo + progreso), manteniendo la opción de pegar una URL externa.
- [x] F3. Guardar la URL resultante (pública o firmada, según se defina el bucket) en `ejercicios.media_url`, sin cambiar el nombre del campo.

**Bloque G — Diferencial (post-MVP) — CERRADO 31/08/2026, ver Decisión 20/21 en `CONTEXT.md`**
- [x] G1. Migrar rutinas a plantilla + asignación (si en A2 se eligió la opción (a)).
- [x] G2. **Rediseñado (Decisión 20): NO es login+policies, es acceso por código individual sin
      sesión.** El profesor pidió explícitamente sacar el login (gente mayor perdería el acceso).
- [~] G3. `cargas_ejercicio` + vista de rutina del alumno con "última carga". **Bloqueado**: asume
      un alumno que escribe datos propios, y el acceso por QR es de solo lectura sin sesión.
- [~] G4. Récords automáticos. **Bloqueado** por lo mismo — depende de G3.
- [x] G5. Cronómetro de descanso. La calculadora de 1RM se armó y se probó, pero se sacó a pedido
      del cliente el mismo día (el profe ya le dice el peso al alumno).
- [x] G6. Notificaciones segmentadas.
- [x] G7. **Resuelto (26/08/2026, ver "Preguntas abiertas" abajo): carga directa del profesor.**
      Coincide con lo que `pagos` ya hace hoy — no hace falta ningún cambio de código.
- [~] G8. **Descartado del alcance (26/08/2026): el cliente confirmó una sola sede.** No solo
      pospuesto — sacado de la lista.
- [~] G9. **Descartado del alcance (26/08/2026): el cliente confirmó que no necesita
      reservas/turnos**, y G9 dependía de eso.

**Lo único genuinamente sin decidir: FASE 3 (más abajo, ítems 20/21/23/24) — "solo si el cliente
lo pide".** No están descartados ni son parte del plan actual, simplemente nunca se preguntaron
porque no son parte del alcance por defecto. Si en algún momento los querés, se charlan igual que
se cerraron las 7 preguntas de más abajo.

---

## NOTA DE NEGOCIO (no técnica) — separada de las decisiones de arriba

**Facturación de Kairox a los gimnasios clientes, si esto se vende como SaaS a varios gimnasios.**
Ultra Gym le cobra al dueño del gimnasio una suscripción mensual por usar la plataforma: es un SaaS multi-tenant donde el "meta-tenant" es la empresa dueña del software (Ultra Gym cobrándole a cada gimnasio, no cada gimnasio cobrándole a sus alumnos — eso ya lo tenemos con `pagos`). Si en algún momento Kairox decide vender esto a varios gimnasios clientes en lugar de un desarrollo a medida para uno solo, hace falta esa misma capa: Kairox facturando a cada `gimnasio_id` por el uso del software (plan, estado de suscripción, período de facturación, medio de cobro).

**Actualización 26/08/2026: la pregunta 3 de abajo ya se respondió — "varios gimnasios" (SaaS
real).** Esta capa de facturación deja de ser hipotética: entra en algún momento de Fase 3+, no
ahora. Sigue sin implementarse nada de esto todavía — es una decisión de negocio que hay que
planificar (qué plan, qué medio de cobro, etc.) antes de tocar código, no algo para arrancar sin
más contexto.

---

## Preguntas abiertas para definir con vos

**Todas respondidas el 26/08/2026 — ver Decisión 21 en `CONTEXT.md` para el detalle completo y
las consecuencias de cada una. Quedan acá tal cual se plantearon, como registro histórico.**

1. ~~¿Rutinas como plantilla desde el arranque (opción b) o después?~~ **Respondida antes, en el
   Bloque A: plantilla desde el arranque.** Construida entera en el Bloque G1.
2. ~~¿El cliente necesita reservas/turnos?~~ **No.** Se descarta también "faltas con penalización
   automática" (1.B.5 / G9), que dependía de esto.
3. ~~¿Vamos a vender esto a varios gimnasios o es para uno solo?~~ **Varios gimnasios (SaaS
   real).** La capa de facturación de Kairox a gimnasios (Nota de negocio de arriba) deja de ser
   hipotética — entra en algún momento de Fase 3+.
4. ~~¿Mantenemos el módulo de nutrición?~~ **Respondida antes por el propio uso: sí**, está activo
   desde el Bloque B y el alumno ya lo ve en su QR (Bloque G2).
5. ~~¿Hay datos reales en PocketBase que haya que migrar?~~ **No — todo lo que hay ahí es de
   prueba.** Arrancamos con la base tal cual está. `apps/pocketbase` puede darse de baja
   definitivamente (ver nota de la sección 1 de `CONTEXT.md`).
6. ~~¿Comprobante con aprobación manual del alumno, o carga directa del profesor?~~ **Carga
   directa del profesor.** Coincide con lo que `pagos` ya hace hoy — no hace falta tocar código.
7. ~~¿El gimnasio tiene o va a tener más de una sede?~~ **No, una sola sede.** 1.B.3 (sedes
   múltiples) queda descartado del alcance, no solo pospuesto.

---

## Fase 2 — Inspirada en investigación de competencia (13/09/2026)

Nalux investigó una app competidora (Planni) y pasó capturas de toda la plataforma: dashboard,
editor de sitio, biblioteca de ejercicios (1993, con video propio), armador de rutinas (bloques/
circuitos/intervalos, desglose por serie), nutrición (ingredientes con equivalencias, planes con
PDF/texto/recetas), módulo de Tareas con % de cumplimiento, ficha de alumno con 5 pestañas,
"Ver como alumno", equipo/colaboradores con roles, y suscripción paga ($34.999 ARS/mes, en
trial). De ahí salió esta fase. Explícitamente fuera de alcance por ahora: editor de sitio web,
chat interno, roles de equipo y facturación con trial — son features de una plataforma que se
vende a miles de entrenadores independientes, no del tamaño de este gimnasio.

**Hallazgo antes de planear:** lo que Nalux pidió para "Día 1: grupo muscular (ej. Espalda-
Bíceps), abajo los ejercicios" **ya existe**. `rutinas.items` tiene un campo `bloque` (texto
libre, con sugerencias) que ya agrupa visualmente los ejercicios de un día bajo un título — mismo
mecanismo, en `RutinasPage.jsx` (`agruparPorBloque()` en `lib/format.js`) y ya se refleja en la
vista de solo lectura y en `MiPlanPage`. Lo único real para hacer ahí es pulir las sugerencias
(bajan a la Fase 2.1) — no hace falta construir nada de cero para eso.

### Fase 2.1 — Pulidas rápidas (bajo esfuerzo, sin cambios de schema mayores)

**Hecha (13/09/2026).** Verificada en vivo con la sesión de Nalux, sin dejar restos de prueba.

- ~~Sugerencias de grupo muscular en el datalist de "Bloque"~~ **hecho**: se sumaron
  "Espalda-Bíceps", "Pecho-Tríceps", "Piernas", "Hombro-Core", "Full body", "Tren superior",
  "Tren inferior" a `BLOQUES_SUGERIDOS` en `RutinasPage.jsx`. Confirmado en el DOM real del
  `<datalist>`.
- ~~Asistencias por día en el Dashboard~~ **hecho**: el tile "Asistencias (7 días)" (que sumaba
  TODOS los presentes de la semana en un solo número) pasó a "Asistencias hoy"
  (`resumen.asistenciasHoy`), y se agregó una tarjeta nueva "Asistencia de la semana" con un
  gráfico de barras día por día (`components/GraficoAsistencias.jsx`, lazy-loaded como
  `GraficoIngresos`), hoy resaltado en el color de marca. Probado en vivo: etiquetas de los 7
  días correctas, sin errores de consola.
- ~~Notas privadas del profesor por alumno~~ **hecho**: columna `alumnos.notas_internas`
  (migración 0048) + componente `NotasPrivadas` en la ficha, justo debajo de "Datos personales".
  Verificado que `ver_plan_por_codigo()` no la selecciona (queda fuera de lo que ve el alumno).
  Probado guardando y limpiando una nota de prueba contra la base real.
- **Toggle "Mostrar kcal y macros al alumno": POSPUESTO, no se hizo.** Se descubrió al ir a
  implementarlo que hoy no hay nada que mostrar u ocultar: `planes_alimentacion_biblioteca.items`
  es texto libre (nombre de comida + descripción), sin ningún vínculo a `alimentos` con
  cantidades que permita calcular kcal/macros de un plan. Ese cálculo recién existe cuando se
  construya la **Fase 2.4** (ingredientes con equivalencias). El toggle se mueve a esa fase, para
  agregarlo junto con el cálculo que le da sentido — construirlo ahora sería un control que no
  hace nada.
- ~~"Duplicar semana" dentro de una rutina multi-semana~~ **hecho**: botón junto al selector de
  semana en `RutinasPage.jsx`, copia todos los ejercicios de la semana activa a la siguiente
  (`duplicarSemanaActual()`). Solo pide confirmación si la semana destino ya tenía contenido; si
  está vacía, copia directo. Todo local -- no se guarda hasta tocar "Guardar" la rutina, así que
  se probó completo (crear, duplicar, verificar visualmente) y se cerró sin guardar, sin dejar
  ningún rastro en la base.

### Fase 2.2 — "Ver como alumno"

**Hecha (13/09/2026).** Resultó ser mucho más barata de lo estimado: `alumno.codigo_acceso` ya
viaja con el `select('*')` de la ficha, y `/mi-plan/:codigo` (la RPC `ver_plan_por_codigo()`) es
la MISMA ruta que usa el alumno real -- no hizo falta simular nada. Un link "Ver como alumno" en
la cabecera de la ficha (`AlumnoPage.jsx`), visible solo si `alumno.activo` (esa RPC exige
`activo=true`). Probado abriendo el link real de un alumno: título "Tu plan | Alumno 3", con su
rutina y el aviso de cuota tal cual él los vería.

### Fase 2.3 — Rutinas: series desglosadas + circuitos/intervalos con timer real

**Hecha (13/09/2026).** La más grande de esta fase, en dos partes.

**A) Desglose de series** (pirámides, drop sets). Cada item de `rutinas.items` puede tener
`seriesDetalle` (array, una fila `{reps, peso}` por serie) -- si no lo tiene, sigue funcionando
exactamente igual que siempre (series/reps/peso uniformes). Helpers nuevos en `lib/format.js`:
`tieneSeriesDetalle`, `desglosarSeries`, `filasDeSeries`, `resumenSeries`. Botón "Desglosar
series" / "Unificar" en el editor (`RutinasPage.jsx`), solo para ejercicios sueltos (no
superseries -- ahí no entra una tabla de series en una caja de 9.5rem sin rehacer ese layout
entero). Actualizado en las 4 pantallas que muestran una rutina: el detalle de solo lectura y el
editor (`RutinasPage.jsx`), la ficha del profesor (`AlumnoPage.jsx`, resumen compacto "12/10/8"),
el plan del alumno (`MiPlanPage.jsx`, tabla grande y legible) y el PDF (`RutinaPDF.jsx`). Probado
en vivo armando una pirámide real (12/40, 10/45, 8/50, 6/55) y confirmando el resumen en la
vista de detalle: "4 series (12/10/8/6 reps · peso variable) · 60 s".

**B) Circuito e Intervalo** (tipo de grupo con rondas). Cada item puede llevar `tipoGrupo`
('circuito' | 'intervalo', ausente = bloque normal), `rondas`, `descansoRondas` y, para
intervalo, `tiempoTrabajo`/`tiempoDescansoEj` -- redundante en todos los items del mismo bloque,
mismo criterio que ya usa `bloque` en sí. Se edita a nivel del bloque entero (un selector +
campos de config en el encabezado del bloque, `RutinasPage.jsx`), no ejercicio por ejercicio.
Intervalo suma un **timer real** en `/mi-plan/:codigo` (`IntervaloModal`, junto a
`CronometroModal` existente): arma la secuencia completa (cada ejercicio de cada ronda, con sus
descansos) y la recorre SOLA, con beep y vibración al cambiar de paso, sin que el alumno tenga
que tocar nada -- circuito termina, muestra "¡Circuito terminado!".

**Bug real encontrado probando en vivo, corregido:** `agruparCombos()` (usada en las 3 pantallas
de solo lectura para fusionar superseries) no copiaba `tipoGrupo`/`rondas`/etc. al objeto
sintético del combo. Como armar un circuito casi siempre significa tildar 2+ ejercicios y
agregarlos juntos (que es justo lo que genera un combo), esto hacía que la etiqueta y el botón
"Iniciar circuito" desaparecieran en el caso más común, no en un caso raro. Se agregó la
propagación de esos campos en `agruparCombos()`. Confirmado con el mismo caso que lo destapó:
"PRUEBA intervalo" con 2 ejercicios agregados juntos, asignada a un alumno de prueba (Alumno 5,
que no tenía ninguna rutina) -- después del fix, "Iniciar circuito" completó las 2 rondas solo y
terminó en "¡Circuito terminado!" sin ninguna interacción intermedia. Datos de prueba borrados
(rutina + la asignación de Alumno 5) después.

### Fase 2.4 — Nutrición: cálculo de macros por comida

**Hecha (13/09/2026), con un alcance distinto al planeado originalmente.** Se investigó primero
`alimentos.unidad` en datos reales: es texto TOTALMENTE libre ("100 g", "1 unidad", "1 cda", "1
scoop (30 g)"...), no la convención fija "todo por 100g" que tiene Planni. Copiar su sistema de
equivalencias (`unidad_sugerida` + gramos por unidad, migración nueva) hubiera significado pedirle
a Nalux que cargue un dato más por cada uno de los 33 alimentos ya existentes antes de que sirviera
para algo.

En cambio, se encontró que el cálculo ya es posible SIN ninguna columna nueva: cada alimento
escala sus propios macros contra SU PROPIA porción de referencia (`unidad`) -- si `unidad` empieza
con un número ("100 g" -> 100), la cantidad que carga el profesor se toma en esas mismas unidades;
si no tiene número ("1 unidad", "1 scoop"), la referencia es 1 y la cantidad es "cuántas veces esa
porción". Cero migración, cero dato nuevo que pedirle a Nalux, funciona con lo que ya está cargado.

Helpers nuevos en `lib/format.js`: `primerNumero`, `macrosDeItem`, `macrosDeComida`,
`resumenMacros`. Nunca inventan un número: un alimento sin macros cargados, borrado de la
biblioteca, o una cantidad sin ningún número (¿"al gusto"?) se cuenta aparte como "sin calcular"
en vez de participar del total. De un grupo de alternativas ("elegir uno: Pollo o Pescado") se usa
solo la primera opción como estimación -- sumar todas contaría comida que el alumno no va a comer.

Mostrado en `PlanesAlimentacionPage.jsx`, tanto en el armador (recalcula en vivo mientras se carga)
como en la vista de solo lectura de un plan. **No se sumó a la ficha del alumno
(`AlumnoPage.jsx`)** -- esa pantalla no carga la biblioteca de alimentos completa hoy, y agregar
esa consulta + el cruce ahí es una extensión menor, pendiente si Nalux la pide.

Probado con datos reales: "Pechuga de pollo (cocida)" (165 kcal / 31g prot / 3.6g grasa por
"100 g") con cantidad "150" dio *"≈ 248 kcal · 47g prot · 0g carb · 5g grasas"* -- coincide exacto
con el cálculo a mano (165 × 1.5 = 247.5 → 248; 31 × 1.5 = 46.5 → 47; 3.6 × 1.5 = 5.4 → 5). El
toggle "mostrar macros al alumno" (pospuesto de la Fase 2.1) sigue sin hacerse: mostrarlo en
`/mi-plan/:codigo` requeriría tocar `ver_plan_por_codigo()` para exponer los macros de cada
alimento referenciado, que es una superficie nueva que conviene revisar con cuidado aparte, no
sumar de apuro acá.

### Fase 2.5 — Progreso con fotos

**Hecha (13/09/2026).** Columna `progreso.foto_path` + bucket nuevo `progreso-fotos` (migración
0049). A diferencia de `alumnos-fotos`/`ejercicios-media` (públicos), este bucket es **privado**
desde el arranque: una foto de progreso físico es más sensible que una de perfil, y es
exactamente el tipo de dato para el que la auditoría de seguridad de esta misma sesión
(11/09/2026) recomendó URLs firmadas como "el paso siguiente" para `alumnos-fotos` -- como este
bucket se creaba de cero, no había motivo para repetir el criterio menos estricto. Se guarda el
PATH del archivo (no una URL pública, que no serviría en un bucket privado) y el cliente pide
signed URLs en batch (`createSignedUrls`, un solo viaje de red) cada vez que cambia la lista de
registros, no una por una en cada render.

UI en `AlumnoPage.jsx` (componente `Progreso`): input de foto opcional en "Nuevo registro" (mismo
patrón de archivo+preview que `AlumnosPage.jsx`), miniatura clickeable en el historial (abre la
foto de tamaño real en pestaña nueva), y el borrado de un registro limpia también el archivo del
bucket (best effort, mismo criterio que `EjerciciosPage.jsx`).

Probado de punta a punta contra la base real, sin poder usar el selector de archivos del sistema
operativo (las herramientas de este entorno no lo automatizan): se creó un registro de prueba, se
subió una imagen real al bucket y se guardó su `foto_path` vía la API REST directa con la sesión
real de Nalux (mismo camino que haría el navegador), se recargó la página y **la miniatura
apareció sola** con una signed URL genuina (`.../object/sign/progreso-fotos/...?token=...`). Se
borró el registro con el botón real de la UI y se confirmó en la base: la fila Y el archivo del
bucket quedaron en 0 -- la limpieza automática funciona.

### Fase 2.6 — "Marcar como hecho" + Fase 2.7 — Historial de cargas del alumno

**Hechas juntas (13/09/2026), con un alcance más simple que el planteado originalmente.** Estas dos
fases fueron las únicas que necesitaban que el alumno pudiera ESCRIBIR desde `/mi-plan/:codigo`
(hasta acá 100% de solo lectura) -- por eso se frenó antes de tocar código y se le preguntó a Nalux
cómo seguir, con tres opciones concretas. Eligió la más simple de las tres: *"Sí, construí las dos
fases completas"* con el diseño de un botón "Marcar como hecho" por día + un campo chico para
cargar el peso de hoy -- no el módulo de Tareas/hábitos con bandeja de revisión y % de cumplimiento
que se había esbozado originalmente para 2.6, ni los récords automáticos de "última carga" por
ejercicio esbozados para 2.7 (G3/G4 del plan original). Ambas quedan como posible extensión futura,
no descartadas, solo no construidas ahora.

**Migración `0050_alumno_escribe_progreso.sql`:**
- Tabla nueva `entrenamientos_completados` (`alumno_id`, `rutina_asignada_id`, `semana`, `dia`,
  `fecha`, `UNIQUE` por los cuatro + fecha) -- un registro por cada día que el alumno marcó, con
  RLS igual al resto (el profesor la ve/gestiona desde el panel; el alumno nunca la toca directo).
- `progreso.origen` (`'profesor'` | `'alumno'`, default `'profesor'`) -- para que la ficha del
  profesor distinga quién cargó cada registro.
- Rate limit propio (`alumnos.escritura_intentos_contador`/`_ventana_inicio`, 30 acciones/5min) --
  **contador separado** del de "ver el plan" (60/5min) y del de login (20/5min), a propósito:
  mismo error que ya se había corregido en la migración 0042 compartiendo contadores de acciones
  distintas.
- `marcar_entrenamiento_hecho(p_codigo, p_semana, p_dia)` -- resuelve el alumno y su rutina activa
  por el código (nunca por un ID que mande el cliente), inserta con `ON CONFLICT ... DO NOTHING`
  (tocar el botón varias veces el mismo día no duplica).
- `alumno_cargar_peso(p_codigo, p_peso)` -- valida `0 < peso <= 400`, actualiza la fila de hoy con
  `origen='alumno'` si ya existe, si no la crea. Cargar dos veces en el mismo día actualiza el
  valor, no duplica el registro.
- `ver_plan_por_codigo()` ahora devuelve `dias_completados_hoy` (array `"semana|dia"`, ya filtrado
  a `fecha = CURRENT_DATE` del lado del server) -- el frontend lo usa para saber qué pintar como
  "Completado" sin tener que llamar a otra función aparte.

**Frontend:**
- `MiPlanPage.jsx`: tarjeta "Tu peso de hoy" (input + botón "Guardar") entre el saludo y "Tu
  rutina"; botón "Marcar como hecho" por cada día de la rutina, que pasa a "Completado hoy" (con
  ícono, en verde) apenas se confirma -- vuelve a aparecer al día siguiente, es un check diario, no
  un progreso acumulado de la rutina entera.
- `AlumnoPage.jsx` (ficha del profesor), para que este dato no quede invisible del lado del
  profesor: en "Progreso" cada registro cargado por el alumno lleva la etiqueta "Cargado por el
  alumno"; en "Entrenamiento", el día que el alumno marcó hoy muestra el badge "El alumno lo marcó
  hoy" junto al conteo de ejercicios.

**Probado de punta a punta contra la base real** (proyecto `fftdmpqbemcnxdnfnvhd`): alumno y rutina
de prueba, las dos funciones nuevas llamadas dos veces cada una (confirma que NO duplican fila),
validaciones de error (peso fuera de rango, código inexistente) confirmadas, `dias_completados_hoy`
reflejando lo recién marcado. Repetido después en el navegador real contra `localhost:3001`: se
marcó el día y se cargó el peso desde `/mi-plan/:codigo`, y ambos aparecieron correctamente en la
ficha del profesor (badge verde + etiqueta "Cargado por el alumno"). Todos los datos de prueba
(alumno, rutina asignada, filas de `progreso` y `entrenamientos_completados`) se borraron después
de cada prueba, confirmado con conteos en 0.

**Fase 2 completa.** Las 7 sub-fases (2.1 a 2.7) están hechas y verificadas.
