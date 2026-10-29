import React from 'react';
import { Helmet } from 'react-helmet';
import { Navigate } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import MisGimnasios from '@/components/configuracion/MisGimnasios';
import { AYUDAS } from '@/lib/guiaDeUso';

// Apartado propio "Mis gimnasios" (pedido de Nalux del 28/10/2026, antes vivía dentro de
// Configuración): lista de gimnasios de la cuenta, abrir otro, agregar uno y eliminar el abierto.
// Solo lo ve el administrador del gimnasio abierto; quien no lo es vuelve al panel (el menú
// tampoco le muestra la opción). Las reglas de verdad están en la base (get_mi_rol), esto es solo
// para no mostrar una pantalla que no le sirve.
const MisGimnasiosPage = () => {
    const { profile, loading, cambiarGimnasio, eliminarGimnasioActivo } = useAuth();

    if (!loading && profile && profile.role !== 'admin') {
        return <Navigate to="/panel" replace />;
    }

    return (
        <AppLayout
            ayuda={AYUDAS.misGimnasios}
            title="Mis gimnasios"
            subtitle="Abrir otro gimnasio, agregar uno nuevo o eliminar el que está abierto."
        >
            <Helmet>
                <title>Mis gimnasios | RutNail</title>
                <meta name="description" content="Gimnasios de la cuenta: abrir, agregar y eliminar." />
            </Helmet>

            <MisGimnasios
                profile={profile}
                cambiarGimnasio={cambiarGimnasio}
                eliminarGimnasioActivo={eliminarGimnasioActivo}
            />
        </AppLayout>
    );
};

export default MisGimnasiosPage;
