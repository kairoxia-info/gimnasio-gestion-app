// Guía de uso para quien maneja el gimnasio (pedido de Nalux, 29/10/2026): qué hace cada pantalla y
// cada botón. UN solo lugar con todo el contenido, para que no se desfasen entre sí:
//   - el ícono "i" de cada pantalla (AyudaInfo) muestra AYUDAS[clave];
//   - la pantalla "Guía de uso" (/guia) las muestra todas, en el orden de MODULOS_GUIA;
//   - el recorrido de bienvenida usa PASOS_TOUR_ADMIN / PASOS_TOUR_EQUIPO.
// Si se agrega o cambia un botón, se actualiza acá y se ve igual en los tres lugares.
//
// Forma de cada ayuda: { resumen, botones: [{ nombre, que }], consejos?: [texto] }.
// Español neutro (sin voseo ni regionalismos), igual que el resto de la app.

export const AYUDAS = {
    panel: {
        resumen: 'Una sola pantalla con el estado del gimnasio: quién entrena, quién debe y cuánto se cobró este mes.',
        botones: [
            {
                nombre: 'Las 4 tarjetas de arriba',
                que: 'Alumnos activos, Al día con el pago, Asistencias hoy y Atrasados o por vencer. Toca cualquiera para ir a esa sección con el detalle.',
            },
            { nombre: 'Caja del mes', que: 'Lo cobrado en el mes en curso y cuántos alumnos están al día, por vencer o atrasados.' },
            { nombre: 'Atención requerida', que: 'Los alumnos con la cuota vencida o sin cuota. "Ver pagos" te lleva a cobrarles.' },
            { nombre: 'Asistencia de la semana', que: 'Cuántos alumnos vinieron cada uno de los últimos 7 días. "Ver asistencia" abre el control diario.' },
            { nombre: 'Ingresos por mes', que: 'Lo cobrado mes a mes durante el último año (incluye lo que archives).' },
            {
                nombre: 'Planes por vencer',
                que: 'Rutinas y planes de comida que vencen en los próximos 7 días o que ya vencieron, según la fecha de fin que les hayas puesto.',
            },
            { nombre: 'Dejaron de venir', que: 'Alumnos activos con más de 10 días sin asistir: buenos candidatos para escribirles.' },
            { nombre: 'Cumpleaños', que: 'Si un alumno cumple años hoy, aparece aquí (hace falta su fecha de nacimiento en la ficha).' },
            { nombre: 'Flujo recomendado', que: 'Los 4 pasos para empezar: preparar la biblioteca, crear el plan, marcar asistencia y registrar el pago.' },
        ],
    },

    alumnos: {
        resumen: 'La lista de tus alumnos, con su estado, su cuota y desde cuándo entrenan.',
        botones: [
            {
                nombre: 'Nuevo alumno',
                que: 'Crea su ficha: nombre, contacto, correo, fecha de alta y plan (obligatorio). Opcionales: fecha de nacimiento, contacto de emergencia, objetivo, observaciones de salud y foto. El estado puede ser Activo, Pendiente o Inactivo.',
            },
            {
                nombre: 'Buscador y filtros (Todos, Activos, Pendientes, Inactivos)',
                que: 'Busca por nombre y filtra por estado. Pendiente: se registró solo por el enlace y espera tu aprobación. Inactivo: está de baja (no cuenta como activo ni aparece para cobrar).',
            },
            { nombre: 'Abrir ficha', que: 'Entra a todo lo de ese alumno: rutina, plan de comida, progreso, asistencia y pagos.' },
            { nombre: 'Editar', que: 'Cambia sus datos, el plan contratado o su estado.' },
            { nombre: 'Revisar y activar', que: 'Solo en los pendientes: revisa los datos que dejó el alumno y lo activa.' },
            {
                nombre: 'Eliminar',
                que: 'Lo borra para siempre, con su historial, sus pagos y sus fotos. Pide confirmación y no se puede deshacer. Para pausar a alguien sin perder nada, pásalo a Inactivo.',
            },
        ],
        consejos: ['Las altas, bajas y cambios importantes de alumnos quedan anotados en el Historial (lo ve el administrador).'],
    },

    ficha: {
        resumen: 'Todo lo de un alumno en un solo lugar.',
        botones: [
            { nombre: 'Ver como alumno', que: 'Abre lo que él ve en su teléfono, para revisar su rutina y su plan tal como le llegan.' },
            { nombre: 'Editar datos', que: 'Cambia sus datos personales, su plan contratado o su estado.' },
            { nombre: 'Notas privadas · Guardar nota', que: 'Anotaciones solo para ti y tu equipo. El alumno nunca las ve.' },
            {
                nombre: 'Acceso del alumno',
                que: 'Crea un usuario y una contraseña para que entre desde su teléfono. Después puedes copiar el enlace, mostrar el QR o enviárselo por WhatsApp. La contraseña solo se ve al crearla; si la pierde, se cambia con "Cambiar contraseña".',
            },
            {
                nombre: 'Estado de cuota · Cobrar',
                que: 'Muestra si está al día y hasta cuándo cubre su último pago. "Cobrar" abre el cobro con su plan ya cargado.',
            },
            {
                nombre: 'Pestaña Entrenamiento',
                que: 'Su rutina asignada. "Descargar PDF" la baja para imprimir, "Cambiar rutina" elige otra, "Quitar rutina" se la saca y "Fecha de fin" hace que avise en el Panel cuando está por vencer.',
            },
            { nombre: 'Pestaña Nutrición', que: 'Igual que Entrenamiento, pero con su plan de alimentación.' },
            {
                nombre: 'Pestaña Progreso',
                que: 'Registra peso y medidas (con foto opcional) cada tanto. Con dos registros o más aparece el gráfico de peso.',
            },
            { nombre: 'Pestaña Asistencia', que: 'Calendario del mes: un toque marca presente, dos marcan ausente y tres borran la marca.' },
            {
                nombre: 'Pestaña Pagos',
                que: 'El historial de pagos de ese alumno. El botón del cesto ("Anular pago") pide un motivo, queda anotado en el Historial y el número de comprobante no se vuelve a usar.',
            },
        ],
    },

    ejercicios: {
        resumen: 'La biblioteca de ejercicios para armar rutinas: unos 500 ya incluidos, con foto o video, más los que agregues.',
        botones: [
            {
                nombre: 'Nuevo ejercicio',
                que: 'Agrega uno propio: nombre, al menos un grupo muscular, patrón de movimiento (opcional) y la demostración (sube una foto o un video, o pega un enlace).',
            },
            { nombre: 'Buscador y filtros', que: 'Busca por nombre; filtra por grupo muscular (Piernas, Espalda...) y por con o sin demostración.' },
            { nombre: 'Ver demostración', que: 'Abre la foto o el video sin salir de la aplicación.' },
            {
                nombre: 'Editar · Eliminar',
                que: 'Solo en los ejercicios tuyos. Los predefinidos tienen un candado y no se editan ni se borran. Si tienes varios gimnasios, tus ejercicios se comparten entre todos y eliminarlo lo borra en todos; las rutinas que ya lo tienen asignado a alumnos lo conservan.',
            },
            {
                nombre: 'Ocultar · pestaña Ocultos',
                que: 'Saca de tus listas un ejercicio predefinido que no usas (solo en este gimnasio). En la pestaña "Ocultos" los ves y puedes tocar "Mostrar de nuevo".',
            },
        ],
    },

    rutinas: {
        resumen: 'Las rutinas se crean una sola vez y se asignan a todos los alumnos que las necesiten.',
        botones: [
            {
                nombre: 'Nueva rutina',
                que: 'Nombre, duración en semanas, descripción y los días. En cada día buscas y eliges ejercicios, con series, repeticiones, peso y descanso; puedes agruparlos en bloques (por ejemplo "Espalda-Bíceps").',
            },
            { nombre: 'Ver', que: 'Muestra la rutina completa tal como la verá el alumno.' },
            {
                nombre: 'Editar',
                que: 'Cambia la rutina de la biblioteca. No modifica la de los alumnos que ya la tienen: para darles la versión nueva, vuelve a asignársela.',
            },
            {
                nombre: 'Asignar a alumnos',
                que: 'Eliges a uno o varios alumnos y la fecha de inicio (y de fin, si quieres). Si alguno ya tenía otra rutina, te avisa antes de reemplazarla.',
            },
            { nombre: 'Duplicar', que: 'Hace una copia ("copia") para modificarla sin tocar la original. Nadie queda asignado a la copia.' },
            { nombre: 'PDF', que: 'Genera la rutina en PDF para imprimirla o enviarla.' },
            {
                nombre: 'Eliminar',
                que: 'La saca de la biblioteca. Los alumnos que ya la tienen la conservan tal cual. Con varios gimnasios, desaparece también de los otros.',
            },
            { nombre: '"N alumnos"', que: 'Cuántos alumnos de este gimnasio la tienen asignada hoy.' },
        ],
        consejos: ['Con varios gimnasios, las rutinas se comparten, pero cada gimnasio ve solo a sus propios alumnos.'],
    },

    alimentos: {
        resumen: 'Los alimentos que usas para armar planes de alimentación, con calorías y macronutrientes por porción.',
        botones: [
            {
                nombre: 'Nuevo alimento',
                que: 'Nombre, categoría, la porción (cantidad, unidad y una aclaración opcional) y las calorías, proteínas, carbohidratos y grasas de esa porción.',
            },
            { nombre: 'Buscador y filtros', que: 'Busca por nombre; filtra por categoría y por con o sin información nutricional.' },
            {
                nombre: 'Editar · Eliminar',
                que: 'Solo en los alimentos tuyos; los predefinidos tienen candado. Con varios gimnasios se comparten entre todos y eliminarlo lo borra en todos.',
            },
            { nombre: 'Ocultar · pestaña Ocultos', que: 'Saca de la lista un alimento predefinido que no usas. En "Ocultos" puedes volver a mostrarlo.' },
        ],
    },

    planes: {
        resumen: 'Cada plan de alimentación se crea una sola vez y se asigna a los alumnos que lo necesiten. El alumno lo ve en su teléfono y puede bajarlo en PDF.',
        botones: [
            {
                nombre: 'Nuevo plan',
                que: 'Armas el plan por comidas del día (desayuno, almuerzo...), eliges los alimentos con su cantidad y puedes marcar alimentos como opcionales o agrupar varios como alternativas (el alumno elige uno).',
            },
            { nombre: 'Ver', que: 'Muestra el plan completo.' },
            {
                nombre: 'Editar',
                que: 'Cambia el plan de la biblioteca. No modifica el de los alumnos que ya lo tienen: para darles la versión nueva, vuelve a asignárselo.',
            },
            { nombre: 'Asignar a alumnos', que: 'Eliges a uno o varios alumnos, la fecha de inicio y, si quieres, la de fin. Si un alumno ya lo tiene, aparece "Quitar".' },
            { nombre: 'Duplicar', que: 'Copia el plan para probar cambios sin tocar el original.' },
            { nombre: 'PDF', que: 'Genera el plan en PDF para imprimirlo o enviarlo.' },
            { nombre: 'Eliminar', que: 'Lo saca de la biblioteca (pide confirmación). Los alumnos que ya lo tienen lo conservan.' },
        ],
        consejos: ['Con varios gimnasios, los planes y los alimentos propios se comparten; cada gimnasio los asigna a sus alumnos.'],
    },

    asistencia: {
        resumen: 'Marca presente o ausente a cada alumno, día por día. Con eso el Panel te muestra quién viene con regularidad y quién dejó de venir.',
        botones: [
            { nombre: 'Pasar lista del día · Por semana · Mes completo', que: 'Tres vistas: el día de hoy para marcar, la semana de todos los alumnos y el mes completo.' },
            {
                nombre: 'Presente · Ausente',
                que: 'Un toque marca. Tocar de nuevo el mismo botón borra la marca. Cada marca se guarda sola, sin botón de guardar.',
            },
            { nombre: 'Cerrar el día', que: 'Marca como ausentes a todos los que quedaron sin marcar, de una vez.' },
            { nombre: 'Actualizar', que: 'Vuelve a leer los datos (útil si otra persona del equipo también está marcando).' },
        ],
    },

    pagos: {
        resumen: 'Cobra, ve quién debe y reimprime cualquier comprobante. La caja del mes y el estado de cada alumno se calculan solos.',
        botones: [
            {
                nombre: 'Registrar pago',
                que: 'Elige al alumno (se completan su plan, el monto y el período), la forma de pago, las fechas, el descuento (%) y el recargo por mora (%). "Saldo que queda debiendo" anota lo que falta si pagó solo una parte. Al cobrar se emite un comprobante numerado.',
            },
            {
                nombre: '"No está pagando ahora"',
                que: 'Le habilita el período igual y anota lo que debe. No emite comprobante: sale recién cuando pague.',
            },
            { nombre: 'Cobrar (en cada alumno de la lista)', que: 'Abre el cobro con ese alumno ya elegido.' },
            { nombre: 'Tarjetas de arriba', que: 'Cobrado este mes, Deuda total (saldos pendientes que anotaste) y el estado de todos los alumnos.' },
            {
                nombre: 'Estados',
                que: 'Al día, Próximo a vencer, Venció (en plazo de gracia), Atrasado, Con deuda y Sin cuota. Se pueden filtrar y buscar por nombre.',
            },
            {
                nombre: 'Comprobantes emitidos',
                que: 'La lista de comprobantes. Al abrir uno puedes imprimirlo, enviarlo por WhatsApp o descargarlo en PDF.',
            },
            {
                nombre: 'Anular un pago',
                que: 'Se hace desde la ficha del alumno, pestaña Pagos (botón del cesto). Pide un motivo y queda anotado en el Historial.',
            },
        ],
        consejos: ['Todo lo que se cobra, edita o anula queda anotado con el nombre de quien lo hizo.'],
    },

    avisos: {
        resumen: 'Mensajes para tus alumnos según el estado de su cuota. Lo ven al abrir su rutina en el teléfono.',
        botones: [
            {
                nombre: 'Nuevo aviso',
                que: 'Título, mensaje y a quién le llega: a todos, o solo a los que están al día, próximos a vencer, vencidos, con deuda o sin cuota. Se calcula solo, cada vez que el alumno entra.',
            },
            { nombre: 'Editar', que: 'Cambia el texto o a quién le llega.' },
            { nombre: 'Enviar por WhatsApp', que: 'Abre WhatsApp con el mensaje ya escrito; tú eliges a quién mandárselo.' },
            { nombre: 'Archivar · Reactivar', que: 'Archivar deja de mostrarlo a los alumnos sin borrarlo; Reactivar lo vuelve a mostrar.' },
            { nombre: '"Entendido" (lo toca el alumno)', que: 'El alumno cierra el aviso con ese botón y no le vuelve a aparecer.' },
        ],
    },

    noticias: {
        resumen: 'Lo que el alumno ve arriba de todo al abrir su rutina: una foto (una promoción, un evento) o un cartel con título y texto.',
        botones: [
            {
                nombre: 'Nueva noticia',
                que: 'Eliges "Imagen" (sube una foto o un flyer: PNG, JPG o WEBP de hasta 5 MB) o "Cartel" (título, texto y color de fondo, con foto opcional).',
            },
            { nombre: 'Activar · Desactivar', que: 'Muestra u oculta la noticia en el portal del alumno sin borrarla.' },
            { nombre: 'Borrar', que: 'La elimina para siempre (pide confirmación).' },
            { nombre: 'Carrusel', que: 'Si hay varias activas, pasan solas. La etiqueta "En el portal · 1 de 3" indica el orden.' },
        ],
        consejos: ['Para mensajes que el alumno tiene que confirmar con "Entendido", usa Avisos.'],
    },

    precios: {
        resumen: 'Qué cobras y por cuánto tiempo. Con esto la aplicación calcula hasta cuándo está cubierto cada alumno.',
        botones: [
            {
                nombre: 'Nuevo plan',
                que: 'Nombre, precio, período (mensual, trimestral...), días por semana, descuento (%) e interés por mora (%). "Plan activo" lo muestra al cobrar; si lo pausas, deja de aparecer.',
            },
            { nombre: 'Nuevo período', que: 'Define cuántos días cubre un pago (por ejemplo Mensual 30, Trimestral 90).' },
            { nombre: 'Nuevo descuento', que: 'Descuentos con nombre y porcentaje, para aplicarlos al cobrar.' },
            {
                nombre: 'Editar · Eliminar',
                que: 'Un plan que tienen alumnos no se puede borrar: cámbiales el plan primero, o pausa el plan para que deje de aparecer al cobrar. Un período en uso tampoco se borra.',
            },
        ],
        consejos: ['Los cambios de precios quedan anotados en el Historial.'],
    },

    equipo: {
        resumen: 'Las personas que trabajan contigo. Cada una entra con su propio correo y contraseña, solo a este gimnasio.',
        botones: [
            {
                nombre: 'Agregar persona',
                que: 'Crea la cuenta (nombre, correo y contraseña; puedes generar una segura). Al terminar aparece un cuadro con el enlace de ingreso, el correo y la contraseña para copiar y entregar. La contraseña solo se ve ahí.',
            },
            { nombre: 'Enlace de ingreso', que: 'El personal entra por la pantalla "Ingreso del equipo" (termina en /ingreso-equipo), distinta de la tuya.' },
            { nombre: 'Pausar · Reactivar', que: 'Corta o devuelve el acceso al instante, sin borrar la cuenta. Quien está pausado ve "Tu acceso está pausado".' },
            {
                nombre: 'Contraseña',
                que: 'Le pone una nueva si la olvidó. Si la persona también trabaja en otro gimnasio, ella debe cambiarla por su cuenta.',
            },
            {
                nombre: 'Quitar (cesto)',
                que: 'Le saca el acceso a este gimnasio; si no trabaja en otro, su cuenta se borra. Lo que registró queda en el Historial.',
            },
        ],
        consejos: [
            'El equipo puede: alumnos, rutinas, planes de alimentación, asistencia, avisos, noticias, cobrar, anular pagos y editar precios. No ve Configuración, Equipo, Historial ni Mis gimnasios, y no puede crear gimnasios.',
            'Un navegador guarda una sola sesión: para estar como administrador y como empleado a la vez hacen falta dos navegadores (o una ventana de incógnito).',
        ],
    },

    historial: {
        resumen: 'Quién registró, editó o anuló pagos, quién cambió los precios y quién dio de alta o baja a un alumno, con fecha y hora.',
        botones: [
            { nombre: 'Filtros por persona y por acción', que: 'Elige a alguien del equipo (aunque todavía no haya hecho nada) o un tipo de acción: Registró, Editó, Eliminó o Anuló.' },
            { nombre: 'Ver detalle', que: 'En las ediciones muestra lo que cambió ("antes → después"); en las anulaciones y bajas, los datos principales.' },
            { nombre: 'Motivo', que: 'Cuando se anula un pago, aquí aparece lo que la persona escribió como motivo.' },
        ],
        consejos: ['Solo lo ve el administrador. Nadie puede modificarlo ni borrarlo, ni siquiera el administrador.'],
    },

    suscripcion: {
        resumen: 'Tu plan de RutNail: hasta cuándo está pago, cuántos alumnos y gimnasios usas y cómo pagar.',
        botones: [
            { nombre: 'Tu plan y Tu uso', que: 'El plan que tienes, hasta cuándo está pago y cuántos alumnos activos y gimnasios usas frente al tope del plan.' },
            { nombre: 'Mensual · Trimestral · Semestral', que: 'Cuánto pagas por mes según el período. Pagando varios meses juntos hay descuento (10 % y 20 %).' },
            { nombre: 'Elegir este plan', que: 'Selecciona el plan y abre el pago. Si tienes más alumnos o gimnasios de los que permite un plan, no te deja elegirlo.' },
            { nombre: 'Pagar con Mercado Pago', que: 'Te lleva a Mercado Pago a pagar. Al volver, esta pantalla confirma el pago sola. Después se cobra automáticamente en cada período.' },
            { nombre: 'Cancelar el cobro automático', que: 'Deja de cobrarte. Sigues con acceso hasta el vencimiento ya pagado.' },
        ],
        consejos: [
            'Si la suscripción vence, la cuenta pasa 7 días a solo lectura (ves todo pero no puedes editar) y después se pausa. Tus datos no se borran.',
            'El correo que escribes debe ser el de tu cuenta de Mercado Pago.',
        ],
    },

    misGimnasios: {
        resumen: 'Los gimnasios que administras con esta cuenta. Cada uno tiene sus propios alumnos, pagos, asistencia y precios.',
        botones: [
            { nombre: 'Abrir', que: 'Cambia al gimnasio elegido y recarga la aplicación con sus datos. También puedes cambiar desde el selector del menú.' },
            { nombre: 'Agregar otro gimnasio', que: 'Crea un gimnasio nuevo en tu cuenta (nombre y logo). Queda abierto al terminar.' },
            {
                nombre: 'Eliminar este gimnasio',
                que: 'Borra el gimnasio que tienes abierto, con todos sus alumnos, pagos y archivos. Pide tu contraseña y no se puede deshacer. Los otros gimnasios no se tocan.',
            },
        ],
        consejos: ['Se comparten entre todos tus gimnasios: rutinas, ejercicios, alimentos y planes de alimentación. Cada gimnasio ve solo a sus propios alumnos.'],
    },

    configuracion: {
        resumen: 'Los datos y las reglas de tu gimnasio. Los planes y precios se configuran en su propia pantalla.',
        botones: [
            {
                nombre: 'Datos del gimnasio',
                que: 'Nombre, logo, color (se aplica a toda la aplicación y a los PDF), zona horaria, días que abre, alias de Mercado Pago y el WhatsApp y correo que figuran en los comprobantes.',
            },
            {
                nombre: 'Alta de alumnos por enlace',
                que: 'Activa un enlace (y su QR) para que los alumnos nuevos se registren solos; quedan como "Pendiente" hasta que los apruebes. "Regenerar código" invalida el enlace anterior.',
            },
            {
                nombre: 'Vencimiento de cuotas',
                que: 'Días de gracia después del vencimiento y con cuántos días de anticipación avisar. Además eliges qué pasa con un alumno vencido: "Dejarlo como está", "Restringirle el acceso" (no ve su rutina o plan hasta que pague) o "Darlo de baja" (pasa a Inactivo).',
            },
            { nombre: 'Comprobante', que: 'El texto que aparece al pie de cada comprobante de pago.' },
            { nombre: 'Aviso automático de cuota', que: 'El cartel que ve el alumno cuando su cuota está por vencer o vencida. Puedes usar {nombre}, {vence}, {plan} y {gimnasio} en el texto.' },
            {
                nombre: 'Archivo de pagos',
                que: 'Resume en un total por mes los pagos anteriores a la fecha que elijas y borra su detalle. Esos comprobantes ya no se pueden reimprimir; el total sigue en "Ingresos por mes". Queda anotado en el Historial.',
            },
            { nombre: 'Eliminar cuenta', que: 'Borra tu cuenta y todo lo que contiene. Pide tu contraseña y no se puede deshacer.' },
        ],
    },
};

// Orden y destino de cada sección en la pantalla "Guía de uso".
export const MODULOS_GUIA = [
    { clave: 'panel', ruta: '/panel', titulo: 'Panel' },
    { clave: 'alumnos', ruta: '/alumnos', titulo: 'Alumnos' },
    { clave: 'ficha', ruta: '/alumnos', titulo: 'Ficha del alumno' },
    { clave: 'ejercicios', ruta: '/ejercicios', titulo: 'Ejercicios' },
    { clave: 'rutinas', ruta: '/rutinas', titulo: 'Rutinas de ejercicios' },
    { clave: 'alimentos', ruta: '/alimentos', titulo: 'Alimentos' },
    { clave: 'planes', ruta: '/planes-alimentacion', titulo: 'Planes de alimentación' },
    { clave: 'asistencia', ruta: '/asistencia', titulo: 'Asistencia' },
    { clave: 'pagos', ruta: '/pagos', titulo: 'Pagos' },
    { clave: 'avisos', ruta: '/avisos', titulo: 'Avisos' },
    { clave: 'noticias', ruta: '/noticias', titulo: 'Noticias' },
    { clave: 'precios', ruta: '/precios', titulo: 'Precios' },
    { clave: 'equipo', ruta: '/equipo', titulo: 'Equipo', soloAdmin: true },
    { clave: 'historial', ruta: '/historial', titulo: 'Historial de cambios', soloAdmin: true },
    { clave: 'misGimnasios', ruta: '/mis-gimnasios', titulo: 'Mis gimnasios', soloAdmin: true },
    { clave: 'suscripcion', ruta: '/suscripcion', titulo: 'Suscripción', soloAdmin: true },
    { clave: 'configuracion', ruta: '/configuracion', titulo: 'Configuración', soloAdmin: true },
];

// Recorrido de bienvenida (una tarjeta por ítem del menú, en el mismo orden que el menú de cada rol).
export const PASOS_TOUR_ADMIN = [
    {
        to: '/panel',
        texto: '¡Bienvenido a RutNail! Este recorrido te muestra qué hay en cada sección. Aquí, en el Panel, ves de un vistazo los alumnos activos, la asistencia de la semana y la caja del mes. Toca cualquier tarjeta para ir a su detalle.',
    },
    {
        to: '/alumnos',
        texto: 'Registra a tus alumnos con "Nuevo alumno" y abre la ficha de cada uno: rutina, plan de alimentación, progreso, asistencia y pagos. Desde la ficha le creas un usuario para que entre desde su teléfono.',
    },
    {
        to: '/ejercicios',
        texto: 'La biblioteca de ejercicios, con unos 500 ya incluidos y foto o video de cómo se hacen. Agrega los tuyos con "Nuevo ejercicio" y oculta los que no uses.',
    },
    {
        to: '/rutinas',
        texto: 'Crea cada rutina una sola vez con "Nueva rutina" y asígnala a todos los alumnos que la necesiten con "Asignar a alumnos". También puedes duplicarla o bajarla en PDF.',
    },
    { to: '/alimentos', texto: 'Tu biblioteca de alimentos, con calorías y macronutrientes por porción. Es la base para armar los planes de comida.' },
    {
        to: '/planes-alimentacion',
        texto: 'Arma planes de comidas por momento del día y asígnalos a tus alumnos, igual que las rutinas. El alumno lo ve en su teléfono.',
    },
    { to: '/asistencia', texto: 'Marca "Presente" o "Ausente" a cada alumno cada día. Cada marca se guarda sola. El Panel usa esto para avisarte quién dejó de venir.' },
    {
        to: '/pagos',
        texto: 'Con "Registrar pago" cobras y se emite un comprobante numerado. La aplicación lleva sola la caja del mes y el estado de cuota de cada alumno.',
    },
    { to: '/avisos', texto: 'Envía mensajes a tus alumnos según el estado de su cuota: lo ven al abrir su rutina y lo cierran con "Entendido".' },
    {
        to: '/noticias',
        texto: 'Sube una foto o arma un cartel (una promoción, un evento, un cambio de horario) y tus alumnos lo ven arriba de todo al abrir su rutina.',
    },
    {
        to: '/precios',
        texto: 'Define qué cobras y por cuánto tiempo, con descuentos y recargo por mora si lo deseas. Es lo primero que conviene dejar listo antes de dar de alta alumnos.',
    },
    {
        to: '/equipo',
        texto: 'Crea la cuenta de las personas que trabajan contigo. Cada una entra con su correo y contraseña a su propio ingreso, y todo lo que hace con pagos y precios queda anotado.',
    },
    { to: '/historial', texto: 'Aquí ves quién cobró, editó o anuló un pago, quién cambió precios y quién dio de alta o baja a un alumno. Solo lo ves tú y no se puede modificar.' },
    {
        to: '/mis-gimnasios',
        texto: 'Si tienes más de un gimnasio, desde aquí los abres, agregas otro o eliminas el que tengas abierto. Las rutinas, ejercicios y planes se comparten; los alumnos y pagos son de cada gimnasio.',
    },
    {
        to: '/configuracion',
        texto: 'Nombre, logo, color y reglas de tu gimnasio, y el enlace para que los alumnos nuevos se registren solos. Un buen lugar para empezar.',
    },
    {
        to: '/guia',
        texto: 'Aquí está la guía de uso: qué hace cada pantalla y cada botón. Y en cada pantalla, el ícono "i" junto al título te explica lo mismo al momento. Desde la guía puedes volver a ver este recorrido cuando quieras.',
    },
];

export const PASOS_TOUR_EQUIPO = [
    {
        to: '/panel',
        texto: '¡Bienvenido a RutNail! Este recorrido te muestra qué puedes hacer en cada sección. En el Panel ves de un vistazo los alumnos activos, la asistencia de hoy y la caja del mes.',
    },
    { to: '/alumnos', texto: 'Aquí están los alumnos. Puedes dar de alta uno nuevo, abrir su ficha (rutina, alimentación, progreso, asistencia y pagos) y editar sus datos.' },
    { to: '/ejercicios', texto: 'La biblioteca de ejercicios, con foto o video de cómo se hacen. Puedes buscar y agregar los tuyos.' },
    { to: '/rutinas', texto: 'Las rutinas. Con "Asignar a alumnos" le das una a uno o a varios alumnos a la vez.' },
    { to: '/alimentos', texto: 'La biblioteca de alimentos, con calorías y macronutrientes por porción.' },
    { to: '/planes-alimentacion', texto: 'Los planes de comida. Se asignan a los alumnos igual que las rutinas.' },
    { to: '/asistencia', texto: 'Marca "Presente" o "Ausente" a cada alumno cada día. Cada marca se guarda sola.' },
    {
        to: '/pagos',
        texto: 'Registra los cobros con "Registrar pago" y se emite el comprobante. Si algo se cargó mal, se anula desde la ficha del alumno, pestaña Pagos, y hay que escribir un motivo. Todo queda anotado a tu nombre.',
    },
    { to: '/avisos', texto: 'Mensajes para los alumnos según el estado de su cuota.' },
    { to: '/noticias', texto: 'Fotos o carteles que los alumnos ven arriba de todo al abrir su rutina.' },
    { to: '/precios', texto: 'Los planes y precios que se cobran. Lo que cambies aquí queda anotado a tu nombre.' },
    {
        to: '/guia',
        texto: 'Aquí está la guía de uso: qué hace cada pantalla y cada botón. En cada pantalla, el ícono "i" junto al título te explica lo mismo al momento. Desde la guía puedes volver a ver este recorrido.',
    },
];

// ---------------------------------------------------------------------------------------------------
// Portal del ALUMNO (pedido de Nalux, 29/10/2026: "lo mismo para el alumno cuando ingrese por primera
// vez"). Mismo formato; textos cortos y directos porque se leen en el teléfono.
// ---------------------------------------------------------------------------------------------------
export const AYUDAS_ALUMNO = {
    rutina: {
        resumen: 'Tu rutina de entrenamiento, día por día.',
        botones: [
            { nombre: 'Día 1, Día 2...', que: 'Cada día tiene sus ejercicios, con series, repeticiones, peso y descanso.' },
            {
                nombre: 'Marcar como hecho',
                que: 'Tócalo al terminar el entrenamiento de ese día: queda registrado y suma a tu racha de la semana (la ves en Progreso). Cuando ya lo marcaste dice "Completado hoy".',
            },
            { nombre: 'Botón de reproducir', que: 'Abre la foto o el video de cómo se hace ese ejercicio.' },
            { nombre: 'Botón del reloj', que: 'Inicia el temporizador del descanso entre series.' },
            { nombre: 'Descargar en PDF', que: 'Baja tu rutina para tenerla en el teléfono o imprimirla.' },
            {
                nombre: 'Noticias y avisos de arriba',
                que: 'Son mensajes de tu gimnasio. Los avisos se cierran con "Entendido" y no vuelven a aparecer.',
            },
        ],
    },
    alimentacion: {
        resumen: 'Tu plan de comidas, con la cantidad de cada alimento.',
        botones: [
            { nombre: 'Comidas (Desayuno, Almuerzo...)', que: 'Cada comida lista lo que te toca comer en ese momento del día.' },
            { nombre: 'Opcional', que: 'Los alimentos marcados como opcionales puedes comerlos o no.' },
            { nombre: 'Alternativas', que: 'Cuando una comida ofrece varias opciones, eliges una de ellas.' },
            { nombre: 'Descargar en PDF', que: 'Baja tu plan para tenerlo en el teléfono o imprimirlo.' },
        ],
    },
    progreso: {
        resumen: 'Cómo vienes entrenando y cómo evoluciona tu peso.',
        botones: [
            { nombre: 'Tu peso de hoy · Guardar', que: 'Escribe tu peso y toca "Guardar". Cada registro suma a tu gráfico.' },
            {
                nombre: 'Entrenamientos esta semana',
                que: 'Cuántas veces marcaste "Marcar como hecho" en los últimos 7 días.',
            },
            { nombre: 'Evolución del peso', que: 'El gráfico aparece desde el segundo registro de peso.' },
        ],
    },
    pagar: {
        resumen: 'Los datos para pagar tu cuota.',
        botones: [
            { nombre: 'Copiar alias', que: 'Copia el alias de Mercado Pago para que lo pegues en tu aplicación y transfieras.' },
            { nombre: 'WhatsApp · Correo', que: 'Para enviar el comprobante después de transferir.' },
            {
                nombre: 'Aviso de cuota',
                que: 'Si tu cuota está por vencer o ya venció, arriba de todo aparece un aviso con un acceso directo a esta sección.',
            },
        ],
        consejos: ['Si aquí no figura nada, consulta en la recepción de tu gimnasio.'],
    },
    general: {
        resumen: 'Cómo moverte por la aplicación.',
        botones: [
            { nombre: 'Botón del menú (arriba a la izquierda)', que: 'Cambia entre Rutina, Alimentación, Progreso y Cómo pagar. Ahí también está "Cerrar sesión".' },
            { nombre: 'Botón del sol o la luna (arriba a la derecha)', que: 'Cambia entre modo claro y modo oscuro.' },
            { nombre: 'Ícono "i" junto a cada título', que: 'Te explica para qué sirve esa pantalla y qué hace cada botón.' },
        ],
    },
};

// Recorrido de bienvenida del alumno (la primera vez que entra en ese teléfono). `to` es la clave del
// ítem de su menú.
export const PASOS_TOUR_ALUMNO = [
    {
        to: 'rutina',
        texto: '¡Bienvenido! Aquí está tu rutina, día por día. Al terminar cada día toca "Marcar como hecho", y con el botón de reproducir ves cómo se hace cada ejercicio.',
    },
    { to: 'alimentacion', texto: 'Tu plan de comidas, con la cantidad de cada alimento. Puedes bajarlo en PDF.' },
    { to: 'progreso', texto: 'Anota tu peso y mira cuántas veces entrenaste esta semana y cómo evoluciona tu peso.' },
    { to: 'pagar', texto: 'Los datos para pagar tu cuota. Si falta poco para que venza, arriba de todo te lo avisamos.' },
    {
        to: 'guia',
        texto: 'Aquí tienes la guía de la aplicación, y puedes volver a ver este recorrido cuando quieras. En cada pantalla, el ícono "i" junto al título te explica qué hace cada botón.',
    },
];
