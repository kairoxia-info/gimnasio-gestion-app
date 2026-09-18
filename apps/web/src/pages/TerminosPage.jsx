import React from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { KairoxFooterMark, Logo, ThemeToggle } from '@/components/AppLayout';

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
// El texto de acá es un borrador de base (Ley 25.326) para el soft launch,
// no un documento revisado por un abogado -- si Nalux quiere sumar CUIT o
// domicilio legal de Kairox IA, hay que agregarlo con el dato real, nunca
// inventado.
const TerminosPage = () => (
    <div className="relative min-h-[100dvh] overflow-hidden bg-background px-4 py-12">
        <Helmet>
            <title>Términos y privacidad | RutNail</title>
            <meta
                name="description"
                content="Términos y condiciones y política de privacidad de RutNail."
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
                        Última actualización: 18 de septiembre de 2026
                    </p>
                </div>

                <div className="space-y-6 text-sm leading-relaxed text-muted-foreground">
                    <section>
                        <h2 className="font-display mb-2 text-base font-bold text-foreground">
                            1. Qué es RutNail
                        </h2>
                        <p>
                            RutNail es un software de gestión que cada gimnasio contrata para
                            administrar sus alumnos, rutinas, planes de alimentación, pagos y
                            comunicaciones internas. Kairox IA desarrolla y mantiene la
                            plataforma, pero no decide qué datos se cargan ni para qué se usan
                            dentro de cada gimnasio: eso lo decide el gimnasio que la usa.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display mb-2 text-base font-bold text-foreground">
                            2. Quién es responsable de tus datos
                        </h2>
                        <p>
                            Si sos alumno de un gimnasio que usa RutNail, el responsable de tus
                            datos personales es ese gimnasio: quien te dio de alta, gestiona tu
                            cuota y arma tu rutina. Kairox IA actúa como encargado del
                            tratamiento: brinda la plataforma técnica sobre la que el gimnasio
                            administra esos datos, con las medidas de seguridad
                            correspondientes, pero no accede a ellos para fines propios ni los
                            comparte con nadie más.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display mb-2 text-base font-bold text-foreground">
                            3. Qué datos se recolectan
                        </h2>
                        <p>
                            Según cómo te dio de alta el gimnasio, puede incluir: nombre y
                            apellido, teléfono, correo electrónico, fecha de nacimiento,
                            contacto de emergencia, una foto, y observaciones de salud
                            relacionadas con la actividad física (por ejemplo, lesiones o
                            condiciones a tener en cuenta para armar tu rutina). Este último es
                            un dato sensible bajo la Ley 25.326, y solo se pide si es relevante
                            para tu entrenamiento. También se registra tu historial de
                            asistencia, tus pagos, y los planes de rutina y alimentación que te
                            asigna el gimnasio.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display mb-2 text-base font-bold text-foreground">
                            4. Para qué se usan
                        </h2>
                        <p>
                            Exclusivamente para que el gimnasio administre tu cuenta: armar y
                            hacerte llegar tu rutina y tu plan de alimentación, llevar el
                            control de tu cuota y tu asistencia, y comunicarte avisos del
                            propio gimnasio (vencimientos, novedades). No se usan para
                            publicidad, y no se venden ni se comparten con terceros ajenos al
                            gimnasio.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display mb-2 text-base font-bold text-foreground">
                            5. Menores de edad
                        </h2>
                        <p>
                            Si tenés menos de 18 años, la aceptación de estos términos y el
                            alta como alumno los tiene que hacer o autorizar tu madre, padre o
                            tutor.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display mb-2 text-base font-bold text-foreground">
                            6. Tus derechos (Ley 25.326)
                        </h2>
                        <p>
                            Podés pedirle al gimnasio, en cualquier momento: acceder a tus
                            datos, corregirlos si están mal, pedir que se eliminen, o pedir que
                            se dejen de usar para algún fin puntual (derechos de acceso,
                            rectificación, cancelación y oposición). El gimnasio es quien tiene
                            que resolver ese pedido, porque es quien administra tu ficha. Si
                            considerás que tu pedido no fue atendido, podés hacer una denuncia
                            ante la Agencia de Acceso a la Información Pública (AAIP), el
                            organismo de control de la Ley 25.326.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display mb-2 text-base font-bold text-foreground">
                            7. Seguridad
                        </h2>
                        <p>
                            Los datos de cada gimnasio están separados de los del resto: un
                            gimnasio nunca puede ver los alumnos de otro. Las contraseñas se
                            guardan encriptadas, nunca en texto plano — ni siquiera el propio
                            gimnasio puede verlas una vez creadas.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display mb-2 text-base font-bold text-foreground">
                            8. Cambios a este texto
                        </h2>
                        <p>
                            Este texto puede actualizarse. La fecha de la última actualización
                            figura arriba de todo.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display mb-2 text-base font-bold text-foreground">
                            9. Contacto
                        </h2>
                        <p>
                            Para consultas sobre la plataforma en sí (no sobre tus datos
                            puntuales, que le corresponden al gimnasio):{' '}
                            <a
                                href="mailto:equipokairox.ia@gmail.com"
                                className="font-medium text-primary hover:underline"
                            >
                                equipokairox.ia@gmail.com
                            </a>
                            .
                        </p>
                    </section>
                </div>
            </div>

            <div className="mt-6">
                <KairoxFooterMark />
            </div>
        </div>
    </div>
);

export default TerminosPage;
