import React from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { EMAIL_SOPORTE, KairoxFooterMark, Logo, ThemeToggle } from '@/components/AppLayout';
import { DIAS_PRUEBA, enlaceWhatsApp } from '@/lib/planesSuscripcion';

// Pantalla estática pública (sin ProtectedRoute, mismo criterio que
// UnirsePage.jsx/AlumnoLoginPage.jsx): cualquiera tiene que poder abrirla sin
// sesión -- desde el registro del profesor, desde el autorregistro del
// alumno, o desde el modal de primer login que se agrega en el punto 2 del
// pedido de Nalux (18/09/2026, "cerrar los gaps legales antes de vender a un
// segundo gimnasio"). Por eso NO usa <AuthBackdrop> (identidad fija oscura,
// sin ThemeToggle, pensada solo para las 3 pantallas de ANTES del login):
// esta pantalla se llega tanto desde ahí como desde pantallas que ya sí
// tienen ThemeToggle/tema claro-oscuro, así que sigue el mismo patrón visual
// "neutro" de UnirsePage.jsx.
//
// Reescrito el 04/11/2026 para sumar la suscripción (cobro automático con Mercado Pago, cancelación,
// devoluciones). Decisión de Nalux: por ahora sin revisión de un abogado; no hay CUIT para publicar (no
// inventar uno) y el domicilio es "Córdoba, Argentina". Cada punto describe cómo funciona la app de
// verdad: si cambia la prueba, los 7 días de solo lectura o la cancelación, hay que cambiarlo acá también.
//
// Punto 7: el derecho de arrepentimiento de 10 días no se puede renunciar (art. 34 Ley 24.240 y art. 1110
// CCyC). El código de gestión en 24 horas viene de la Disposición 954/2025 y hoy se manda a mano.

const Apartado = ({ titulo, children }) => (
    <section>
        <h3 className="font-display mb-2 text-base font-bold text-foreground">{titulo}</h3>
        {children}
    </section>
);

const Parte = ({ children }) => (
    <h2 className="font-display border-b border-border pb-2 pt-2 text-lg font-bold text-foreground">{children}</h2>
);

const claseEnlace = 'font-medium text-primary hover:underline';

const Correo = () => (
    <a href={`mailto:${EMAIL_SOPORTE}`} className={claseEnlace}>
        {EMAIL_SOPORTE}
    </a>
);

const WhatsApp = ({ mensaje, children }) => (
    <a href={enlaceWhatsApp(mensaje)} target="_blank" rel="noopener noreferrer" className={claseEnlace}>
        {children}
    </a>
);

const TerminosPage = () => (
    <div className="relative min-h-[100dvh] overflow-hidden bg-background px-4 py-12">
        <Helmet>
            <title>Términos y privacidad | RutNail</title>
            <meta
                name="description"
                content="Términos y condiciones, suscripción, devoluciones y política de privacidad de RutNail."
            />
        </Helmet>

        <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-32 top-0 h-[36rem] w-[36rem] rounded-full bg-primary/20 blur-3xl"
        />
        <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-32 bottom-0 h-[28rem] w-[28rem] rounded-full bg-primary/10 blur-3xl"
        />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-primary" />

        <div className="absolute right-4 top-4">
            <ThemeToggle />
        </div>

        <div className="relative mx-auto max-w-2xl">
            <Link
                to="/login"
                className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
                <ArrowLeft className="h-4 w-4" strokeWidth={1.8} /> Volver
            </Link>

            <div className="rounded-3xl border border-border bg-card p-8">
                <div className="mb-8 flex flex-col items-center text-center">
                    <Logo className="h-16" />
                    <h1 className="font-display mt-4 text-2xl font-bold">
                        Términos y condiciones · Política de privacidad
                    </h1>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Última actualización: 4 de noviembre de 2026
                    </p>
                </div>

                <div className="space-y-6 text-sm leading-relaxed text-muted-foreground">
                    <p>
                        Este documento regula el uso de RutNail. Al crear una cuenta, contratar un plan o usar
                        la plataforma, aceptas estos términos.
                    </p>

                    <Parte>Términos y condiciones</Parte>

                    <Apartado titulo="1. El servicio y quién lo presta">
                        <p>
                            RutNail es un software de gestión en línea que cada gimnasio contrata para administrar
                            sus alumnos, rutinas, planes de alimentación, pagos y comunicaciones internas. El
                            servicio lo desarrolla y presta Kairox IA, con domicilio en Córdoba, República
                            Argentina. En este texto, «titular» es la persona que crea la cuenta del gimnasio y
                            contrata el servicio; «equipo» son las personas a las que el titular les da acceso; y
                            «alumno» es quien entrena en ese gimnasio.
                        </p>
                    </Apartado>

                    <Apartado titulo="2. Cuenta y uso permitido">
                        <p>
                            El titular debe ser mayor de 18 años y tener capacidad para contratar. Se compromete a
                            cargar información verdadera, a cuidar sus contraseñas y a responder por lo que se haga
                            desde su cuenta y desde las de su equipo. También declara que tiene derecho a cargar
                            los datos de sus alumnos. No está permitido usar RutNail con fines ilegales, intentar
                            entrar a cuentas ajenas, afectar el funcionamiento de la plataforma ni revender el
                            acceso. Kairox IA puede suspender una cuenta que no cumpla estos puntos.
                        </p>
                    </Apartado>

                    <Apartado titulo="3. Prueba gratis">
                        <p>
                            Cada cuenta nueva tiene {DIAS_PRUEBA} días de prueba gratis, con las funciones del plan
                            Estándar, sin tarjeta y sin ningún cobro. Al terminar la prueba no se cobra nada de
                            forma automática: para seguir hay que elegir un plan. Si no se elige, se aplica lo
                            indicado en el punto 6.
                        </p>
                    </Apartado>

                    <Apartado titulo="4. Planes, precios y forma de pago">
                        <p>
                            Los planes, sus límites y sus precios, en pesos argentinos, son los publicados en la
                            página de RutNail y en la pantalla Suscripción al momento de contratar. Se puede pagar
                            cada mes, cada 3 meses o cada 6 meses, con los descuentos que se indiquen. El pago se
                            hace a través de Mercado Pago, con la cuenta de Mercado Pago o con tarjeta: Kairox IA
                            no ve ni guarda los datos de la tarjeta. Si cambian los precios, se avisa con al menos
                            30 días de anticipación, por correo o dentro de la aplicación, y el cambio no afecta el
                            período ya pagado.
                        </p>
                    </Apartado>

                    <Apartado titulo="5. Renovación automática y cancelación">
                        <p>
                            Al contratar un plan se activa un cobro automático que se repite en cada período, por
                            el mismo importe, hasta que se cancele. No hay permanencia mínima. El titular puede
                            cancelar el cobro automático en cualquier momento y sin costo desde la pantalla
                            Suscripción, o pedirlo con el enlace «Botón de baja de servicio» de la página de
                            inicio. Al cancelar no se hacen más cobros y la cuenta sigue funcionando hasta el
                            último día del período ya pagado.
                        </p>
                    </Apartado>

                    <Apartado titulo="6. Vencimiento o falta de pago">
                        <p>
                            Si la prueba o el período pagado vence sin renovarse, la cuenta pasa a solo lectura
                            durante 7 días: se puede ver la información, pero no modificarla. Después de esos 7
                            días el acceso se pausa, también para el equipo y los alumnos del gimnasio. El
                            vencimiento no borra los datos: al pagar un plan, la cuenta vuelve a funcionar con todo
                            lo que tenía.
                        </p>
                    </Apartado>

                    <Apartado titulo="7. Arrepentimiento y devoluciones">
                        <p>
                            Quien contrata como consumidor puede revocar la contratación dentro de los 10 días
                            corridos desde que la hizo, sin dar explicaciones y sin costo, conforme al artículo 34
                            de la Ley 24.240 y al artículo 1110 del Código Civil y Comercial de la Nación. Para
                            hacerlo basta con usar el enlace «Botón de arrepentimiento» de la página de inicio, o
                            escribir a <Correo /> o por{' '}
                            <WhatsApp mensaje="Hola, quiero arrepentirme de mi contratación de RutNail.">
                                WhatsApp
                            </WhatsApp>
                            , sin ningún trámite previo. Dentro de las 24 horas se envía un código de identificación
                            de la gestión, y el importe pagado se devuelve por el mismo medio de pago.
                        </p>
                        <p className="mt-2">
                            Pasado ese plazo, los períodos ya pagados no se devuelven, ni total ni
                            proporcionalmente, salvo error en el cobro o cuando la ley disponga otra cosa.
                        </p>
                    </Apartado>

                    <Apartado titulo="8. Baja de la cuenta">
                        <p>
                            El titular puede eliminar su cuenta desde Configuración. Esa acción borra de forma
                            definitiva el gimnasio y todos sus datos, y no se puede deshacer. Si tiene el cobro
                            automático activo, primero debe cancelarlo: la aplicación no permite eliminar la cuenta
                            hasta entonces.
                        </p>
                    </Apartado>

                    <Apartado titulo="9. Disponibilidad y responsabilidad">
                        <p>
                            Kairox IA trabaja para que RutNail funcione de forma continua y segura, pero no
                            garantiza que el servicio esté libre de interrupciones o errores: puede haber pausas
                            por mantenimiento o por fallas de proveedores externos. Las rutinas, los planes de
                            alimentación y las indicaciones que reciben los alumnos los define cada gimnasio, que
                            es el único responsable de su contenido; RutNail no brinda asesoramiento médico ni
                            nutricional, y la biblioteca de ejercicios incluida es una referencia general.
                        </p>
                        <p className="mt-2">
                            En la medida que lo permita la ley, Kairox IA no responde por daños indirectos ni por
                            lucro cesante. Nada de lo dicho en estos términos limita los derechos que la ley
                            reconoce a los consumidores.
                        </p>
                    </Apartado>

                    <Apartado titulo="10. Propiedad intelectual">
                        <p>
                            El software, la marca RutNail y el contenido propio de la plataforma pertenecen a
                            Kairox IA. Los datos que carga cada gimnasio siguen siendo de ese gimnasio.
                        </p>
                    </Apartado>

                    <Parte>Política de privacidad</Parte>

                    <Apartado titulo="11. Quién es responsable de los datos">
                        <p>
                            Si eres alumno de un gimnasio que usa RutNail, el responsable de tus datos personales
                            es ese gimnasio: quien te dio de alta, gestiona tu cuota y arma tu rutina. Kairox IA
                            actúa como encargado del tratamiento: brinda la plataforma técnica sobre la que el
                            gimnasio administra esos datos, con las medidas de seguridad correspondientes, y no los
                            usa para fines propios. De los datos de la cuenta del titular y de su equipo, el
                            responsable es Kairox IA.
                        </p>
                    </Apartado>

                    <Apartado titulo="12. Qué datos se recolectan">
                        <p>
                            De los alumnos, según cómo los dio de alta el gimnasio: nombre y apellido, teléfono,
                            correo electrónico, fecha de nacimiento, contacto de emergencia, una foto, y
                            observaciones de salud relacionadas con la actividad física (por ejemplo, lesiones o
                            condiciones a tener en cuenta para armar la rutina). Este último es un dato sensible
                            bajo la Ley 25.326, y solo se pide si es relevante para el entrenamiento. También se
                            registra el historial de asistencia, los pagos, y los planes de rutina y alimentación
                            que asigna el gimnasio.
                        </p>
                        <p className="mt-2">
                            Del titular y su equipo: nombre, correo electrónico, los datos del gimnasio, el plan
                            contratado, el estado de la suscripción y la fecha de los pagos.
                        </p>
                        <p className="mt-2">
                            De todos los usuarios, incluidos los alumnos, se guardan registros técnicos de errores
                            (por ejemplo, la pantalla y el navegador en los que ocurrió una falla), para poder
                            corregirlos. Esos registros no incluyen el nombre del alumno ni sus datos personales.
                        </p>
                    </Apartado>

                    <Apartado titulo="13. Para qué se usan">
                        <p>
                            Los datos de los alumnos se usan exclusivamente para que el gimnasio administre su
                            cuenta: armar y hacerle llegar la rutina y el plan de alimentación, llevar el control
                            de la cuota y la asistencia, y comunicar avisos del propio gimnasio. Los datos del
                            titular y su equipo se usan para prestar el servicio, gestionar la suscripción, dar
                            soporte, detectar errores y enviar avisos sobre la cuenta. No se usan para publicidad
                            de terceros y no se venden.
                        </p>
                    </Apartado>

                    <Apartado titulo="14. Con quién se comparten">
                        <p>
                            Para funcionar, RutNail usa proveedores que tratan datos por cuenta de Kairox IA:
                            Supabase (base de datos y acceso a las cuentas), Vercel (alojamiento del sitio), Google
                            (envío de correos de la cuenta), Mercado Pago (cobro de la suscripción) y Telegram
                            (avisos internos al equipo de RutNail, que incluyen el nombre del gimnasio pero no
                            datos de alumnos). Algunos de ellos pueden procesar la información fuera de Argentina.
                            Fuera de estos casos, los datos solo se entregan si la ley o una autoridad competente
                            lo exige.
                        </p>
                    </Apartado>

                    <Apartado titulo="15. Menores de edad">
                        <p>
                            Si tienes menos de 18 años, la aceptación de estos términos y el alta como alumno las
                            tiene que hacer o autorizar tu madre, padre o tutor.
                        </p>
                    </Apartado>

                    <Apartado titulo="16. Tus derechos (Ley 25.326)">
                        <p>
                            Puedes pedir en cualquier momento acceder a tus datos, corregirlos si están mal, que se
                            eliminen, o que se dejen de usar para algún fin puntual (derechos de acceso,
                            rectificación, cancelación y oposición). Si eres alumno, el pedido se hace al gimnasio,
                            porque es quien administra tu ficha; si eres titular o parte de un equipo, se hace a
                            Kairox IA. Si consideras que tu pedido no fue atendido, puedes hacer una denuncia ante
                            la Agencia de Acceso a la Información Pública (AAIP), el organismo de control de la Ley
                            25.326.
                        </p>
                    </Apartado>

                    <Apartado titulo="17. Seguridad">
                        <p>
                            Los datos de cada gimnasio están separados de los del resto: un gimnasio nunca puede
                            ver los alumnos de otro. Las contraseñas se guardan encriptadas, nunca en texto plano:
                            ni siquiera el propio gimnasio puede verlas una vez creadas.
                        </p>
                    </Apartado>

                    <Parte>Disposiciones generales</Parte>

                    <Apartado titulo="18. Cambios a este texto">
                        <p>
                            Este texto puede actualizarse. La fecha de la última actualización figura arriba de
                            todo. Si un cambio afecta la suscripción o los derechos del titular, se avisa por
                            correo o dentro de la aplicación antes de que entre en vigencia.
                        </p>
                    </Apartado>

                    <Apartado titulo="19. Ley aplicable y jurisdicción">
                        <p>
                            Estos términos se rigen por las leyes de la República Argentina. Cualquier conflicto se
                            somete a los tribunales ordinarios de la ciudad de Córdoba, sin perjuicio del derecho
                            de quien contrata como consumidor de recurrir a los tribunales de su domicilio o a los
                            organismos de defensa del consumidor.
                        </p>
                    </Apartado>

                    <Apartado titulo="20. Contacto">
                        <p>
                            Kairox IA · Córdoba, Argentina. Para consultas sobre la plataforma, la suscripción o
                            estos términos: <Correo /> o{' '}
                            <WhatsApp mensaje="Hola, tengo una consulta sobre RutNail.">WhatsApp</WhatsApp>. Las
                            consultas sobre tus datos como alumno le corresponden a tu gimnasio.
                        </p>
                    </Apartado>
                </div>
            </div>

            <div className="mt-6">
                <KairoxFooterMark />
            </div>
        </div>
    </div>
);

export default TerminosPage;
