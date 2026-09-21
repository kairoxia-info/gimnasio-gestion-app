import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import supabase from '@/lib/supabaseClient';
import DatosGimnasio from '@/components/configuracion/DatosGimnasio';
import AltaAlumnosPorLink from '@/components/configuracion/AltaAlumnosPorLink';
import VencimientoCuotas from '@/components/configuracion/VencimientoCuotas';
import Comprobante from '@/components/configuracion/Comprobante';
import AvisoAutomaticoCuota from '@/components/configuracion/AvisoAutomaticoCuota';
import ArchivoPagos from '@/components/configuracion/ArchivoPagos';
import EliminarCuenta from '@/components/configuracion/EliminarCuenta';

// Mismo bug y mismo fix que components/configuracion/DatosGimnasio.jsx: este
// default tiene que coincidir con el color de fábrica real de index.css
// (hsl(42, 92%, 54%) = #F6B51E), no con el rojo viejo de antes del
// 07/09/2026.
const COLOR_DEFAULT = '#F6B51E';
const DIAS_ABIERTOS_DEFAULT = [1, 2, 3, 4, 5, 6];

const ConfiguracionPage = () => {
    const { profile, refreshProfile, eliminarCuenta, signOut } = useAuth();

    // Fila completa de "gimnasios" (id, codigo_invitacion, autorregistro_activo,
    // etc.): useAuth().gimnasio solo trae nombre/logo_url/color_principal (ver
    // AuthContext.fetchProfile), no alcanza para esta página. RLS ya permite
    // este SELECT (policy gimnasios_select).
    const [gimnasioFull, setGimnasioFull] = useState(null);
    const [gimnasioLoading, setGimnasioLoading] = useState(true);
    const [gimnasioError, setGimnasioError] = useState('');

    const [dgForm, setDgForm] = useState({
        nombre: '',
        color_principal: COLOR_DEFAULT,
        dias_abiertos: DIAS_ABIERTOS_DEFAULT,
        alias_mercadopago: '',
    });

    // Vencimiento de cuotas (migración 0013). El % de recargo NO va acá: ya
    // existe por plan (interes_mora, más abajo en esta misma pantalla) y tener
    // dos perillas para el mismo número termina en que no coinciden.
    //
    // politica_vencimiento_cuota/restringir_rutina/restringir_alimentacion
    // (migraciones 0020/0021): qué pasa con un alumno vencido, más allá del
    // cartel visual que ya existía. "Darlo de baja" lo aplica AppLayout.jsx
    // de forma perezosa (ver ese archivo) -- acá solo se guarda la decisión.
    const [vencForm, setVencForm] = useState({
        dias_gracia_cuota: '0',
        dias_aviso_vencimiento: '7',
        politica_vencimiento_cuota: 'dejar',
        restringir_rutina: true,
        restringir_alimentacion: false,
    });

    // Aviso automático de cuota (migración 0015): una plantilla por gimnasio,
    // que ver_plan_por_codigo() arma sola para cada alumno según su propio
    // vencimiento -- no se guarda un aviso por alumno.
    const [avisoCuotaForm, setAvisoCuotaForm] = useState({ activo: false, titulo: '', mensaje: '' });

    // Texto de pie del comprobante (migración 0018) — antes fijo en el
    // código de PagosPage.jsx ("Este comprobante no es válido como
    // factura."), pedido editable al investigar Configuración.
    const [comprobanteTexto, setComprobanteTexto] = useState('');

    const cargarGimnasio = () => {
        if (!profile?.gimnasio_id) return;
        setGimnasioLoading(true);
        supabase
            .from('gimnasios')
            .select('*')
            .eq('id', profile.gimnasio_id)
            .single()
            .then(({ data, error: err }) => {
                if (err) throw err;
                setGimnasioFull(data);
                setDgForm({
                    nombre: data.nombre || '',
                    color_principal: data.color_principal || COLOR_DEFAULT,
                    dias_abiertos: data.dias_abiertos?.length ? data.dias_abiertos : DIAS_ABIERTOS_DEFAULT,
                    alias_mercadopago: data.alias_mercadopago || '',
                });
                setVencForm({
                    dias_gracia_cuota: String(data.dias_gracia_cuota ?? 0),
                    dias_aviso_vencimiento: String(data.dias_aviso_vencimiento ?? 7),
                    politica_vencimiento_cuota: data.politica_vencimiento_cuota || 'dejar',
                    restringir_rutina: data.restringir_rutina ?? true,
                    restringir_alimentacion: data.restringir_alimentacion ?? false,
                });
                setAvisoCuotaForm({
                    activo: !!data.aviso_cuota_activo,
                    titulo: data.aviso_cuota_titulo || '',
                    mensaje: data.aviso_cuota_mensaje || '',
                });
                setComprobanteTexto(data.comprobante_texto_pie ?? '');
                setGimnasioError('');
            })
            .catch(() => setGimnasioError('No se pudieron cargar los datos del gimnasio.'))
            .finally(() => setGimnasioLoading(false));
    };

    useEffect(cargarGimnasio, [profile?.gimnasio_id]);

    const esAdminConGimnasio = profile?.role === 'admin' && !!profile?.gimnasio_id;

    return (
        <AppLayout
            ayuda="Nombre, logo y color de tu gimnasio (el color se aplica a toda la aplicación y a los PDF), el texto del comprobante, los días de gracia de la cuota, y el enlace para que los alumnos nuevos se registren por su cuenta desde el teléfono."
            title="Configuración"
            subtitle="Los datos y las reglas del gimnasio. Los planes y precios se configuran en su propia pantalla."
        >
            <Helmet>
                <title>Configuración | RutNail</title>
                <meta
                    name="description"
                    content="Datos del gimnasio, logo y color, comprobante y reglas de vencimiento de cuotas."
                />
            </Helmet>

            <div className="mb-6 space-y-6">
                <DatosGimnasio
                    gimnasioFull={gimnasioFull}
                    gimnasioLoading={gimnasioLoading}
                    gimnasioError={gimnasioError}
                    dgForm={dgForm}
                    setDgForm={setDgForm}
                    refreshProfile={refreshProfile}
                    cargarGimnasio={cargarGimnasio}
                />
            </div>

            {/* Alta de alumnos por link/QR (migración 0004): la base y las RPC ya
                existían, esta tarjeta es la pantalla que faltaba para poder
                usarlas -- pedido de Nalux (09/09/2026). */}
            {gimnasioFull && (
                <AltaAlumnosPorLink gimnasioFull={gimnasioFull} setGimnasioFull={setGimnasioFull} />
            )}

            <VencimientoCuotas
                gimnasioFull={gimnasioFull}
                setGimnasioFull={setGimnasioFull}
                vencForm={vencForm}
                setVencForm={setVencForm}
            />

            <Comprobante
                gimnasioFull={gimnasioFull}
                setGimnasioFull={setGimnasioFull}
                comprobanteTexto={comprobanteTexto}
                setComprobanteTexto={setComprobanteTexto}
            />

            <AvisoAutomaticoCuota
                gimnasioFull={gimnasioFull}
                setGimnasioFull={setGimnasioFull}
                avisoCuotaForm={avisoCuotaForm}
                setAvisoCuotaForm={setAvisoCuotaForm}
            />

            <ArchivoPagos />

            <EliminarCuenta
                esAdminConGimnasio={esAdminConGimnasio}
                eliminarCuenta={eliminarCuenta}
                signOut={signOut}
            />
        </AppLayout>
    );
};

export default ConfiguracionPage;
