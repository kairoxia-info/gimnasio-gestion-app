import React, { useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { Btn, Card, ErrorBox, Field, Input, Loading } from '@/components/ui-kit';
import { updateRec } from '@/lib/data';
import supabase from '@/lib/supabaseClient';

// Mismo criterio que OnboardingPage.jsx (subida de logo): 2 MB de tope y
// solo estos tres formatos, para no duplicar lógica de validación distinta
// en dos lugares del mismo flujo.
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MIME_TO_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const COLOR_DEFAULT = '#E10600';

// Días que abre el gimnasio (migración 0031). Los números son los mismos
// que devuelve Date.getDay() (0 = domingo), pero se listan arrancando en
// lunes porque es como se lee una semana acá.
const DIAS_SEMANA = [
    { numero: 1, etiqueta: 'Lun' },
    { numero: 2, etiqueta: 'Mar' },
    { numero: 3, etiqueta: 'Mié' },
    { numero: 4, etiqueta: 'Jue' },
    { numero: 5, etiqueta: 'Vie' },
    { numero: 6, etiqueta: 'Sáb' },
    { numero: 0, etiqueta: 'Dom' },
];

const DatosGimnasio = ({
    gimnasioFull,
    gimnasioLoading,
    gimnasioError,
    dgForm,
    setDgForm,
    refreshProfile,
    cargarGimnasio,
}) => {
    const [logoFile, setLogoFile] = useState(null);
    const [logoPreview, setLogoPreview] = useState('');
    const [dgSaving, setDgSaving] = useState(false);
    const [dgError, setDgError] = useState('');
    const logoInputRef = useRef(null);

    const onLogoChange = (e) => {
        const file = e.target.files?.[0];
        setDgError('');
        if (!file) {
            setLogoFile(null);
            setLogoPreview('');
            return;
        }
        if (!MIME_TO_EXT[file.type]) {
            setDgError('El logo debe ser PNG, JPG o WEBP.');
            e.target.value = '';
            return;
        }
        if (file.size > MAX_LOGO_BYTES) {
            setDgError('El logo no puede pesar más de 2 MB.');
            e.target.value = '';
            return;
        }
        setLogoFile(file);
        setLogoPreview(URL.createObjectURL(file));
    };

    const guardarDatosGimnasio = async (e) => {
        e.preventDefault();
        if (!gimnasioFull?.id) return;
        setDgSaving(true);
        setDgError('');
        // La base tiene un CHECK que exige al menos un día (migración 0031);
        // se avisa acá con un mensaje entendible en vez de dejar que vuelva
        // el error crudo de Postgres.
        if (dgForm.dias_abiertos.length === 0) {
            setDgError('Elegir al menos un día en el que el gimnasio abre.');
            setDgSaving(false);
            return;
        }
        try {
            await updateRec('gimnasios', gimnasioFull.id, {
                nombre: dgForm.nombre.trim(),
                color_principal: dgForm.color_principal || COLOR_DEFAULT,
                dias_abiertos: dgForm.dias_abiertos,
            });

            if (logoFile) {
                const ext = MIME_TO_EXT[logoFile.type];
                const path = `${gimnasioFull.id}/logo.${ext}`;
                const { error: uploadError } = await supabase.storage
                    .from('gimnasio-logos')
                    .upload(path, logoFile, { upsert: true });
                if (uploadError) throw uploadError;

                const {
                    data: { publicUrl },
                } = supabase.storage.from('gimnasio-logos').getPublicUrl(path);

                await updateRec('gimnasios', gimnasioFull.id, { logo_url: publicUrl });
            }

            setLogoFile(null);
            setLogoPreview('');
            if (logoInputRef.current) logoInputRef.current.value = '';
            await refreshProfile();
            cargarGimnasio();
        } catch (_) {
            setDgError(
                'No se pudieron guardar los datos del gimnasio. Si no es administrador, no tiene permiso para editar esto.',
            );
        } finally {
            setDgSaving(false);
        }
    };

    return (
        <Card>
            <h2 className="font-display text-lg font-bold">Datos del gimnasio</h2>
            <p className="mt-1 text-sm text-muted-foreground">
                Nombre, logo y color que se ven adentro de la app.
            </p>

            {gimnasioError && (
                <div className="mt-4">
                    <ErrorBox>{gimnasioError}</ErrorBox>
                </div>
            )}

            {gimnasioLoading ? (
                <div className="mt-4">
                    <Loading rows={2} />
                </div>
            ) : gimnasioFull ? (
                <form onSubmit={guardarDatosGimnasio} className="mt-4 space-y-4">
                    <Field label="Nombre del gimnasio">
                        <Input
                            value={dgForm.nombre}
                            onChange={(e) => setDgForm({ ...dgForm, nombre: e.target.value })}
                            required
                        />
                    </Field>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Logo">
                            <div className="flex items-center gap-3">
                                {logoPreview || gimnasioFull.logo_url ? (
                                    <img
                                        src={logoPreview || gimnasioFull.logo_url}
                                        alt="Logo del gimnasio"
                                        className="h-12 w-12 shrink-0 rounded-xl border border-border object-contain"
                                    />
                                ) : (
                                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground">
                                        <ImagePlus className="h-5 w-5" strokeWidth={1.6} />
                                    </div>
                                )}
                                <input
                                    ref={logoInputRef}
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    onChange={onLogoChange}
                                    className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground file:transition hover:file:brightness-110"
                                />
                            </div>
                            <span className="text-xs text-muted-foreground">
                                PNG, JPG o WEBP. Máximo 2 MB.
                            </span>
                        </Field>

                        <Field label="Color principal">
                            <input
                                type="color"
                                value={dgForm.color_principal || COLOR_DEFAULT}
                                onChange={(e) =>
                                    setDgForm({ ...dgForm, color_principal: e.target.value })
                                }
                                className="h-11 w-20 cursor-pointer rounded-lg border border-input bg-background p-1"
                            />
                        </Field>
                    </div>

                    {/* Pedido de Nalux (07/09/2026): los domingos el gimnasio
                        suele estar cerrado, pero que lo elija cada profesor.
                        En la grilla de asistencia los días cerrados quedan
                        atenuados y no se pueden marcar. */}
                    <Field label="Días que abre el gimnasio">
                        <div className="flex flex-wrap gap-2">
                            {DIAS_SEMANA.map(({ numero, etiqueta }) => {
                                const activo = dgForm.dias_abiertos.includes(numero);
                                return (
                                    <button
                                        key={numero}
                                        type="button"
                                        aria-pressed={activo}
                                        onClick={() =>
                                            setDgForm((f) => ({
                                                ...f,
                                                dias_abiertos: activo
                                                    ? f.dias_abiertos.filter((n) => n !== numero)
                                                    : [...f.dias_abiertos, numero].sort(),
                                            }))
                                        }
                                        className={`h-10 w-12 rounded-xl border text-xs font-bold uppercase transition active:scale-95 ${
                                            activo
                                                ? 'border-transparent bg-primary text-primary-foreground'
                                                : 'border-border text-muted-foreground hover:border-primary'
                                        }`}
                                    >
                                        {etiqueta}
                                    </button>
                                );
                            })}
                        </div>
                        <span className="text-xs text-muted-foreground">
                            Los días apagados aparecen en gris en la asistencia y no cuentan como
                            falta. Tiene que quedar al menos uno encendido.
                        </span>
                    </Field>

                    {dgError && <ErrorBox>{dgError}</ErrorBox>}

                    <div className="flex justify-end">
                        <Btn type="submit" disabled={dgSaving}>
                            {dgSaving ? 'Guardando...' : 'Guardar cambios'}
                        </Btn>
                    </div>
                </form>
            ) : null}
        </Card>
    );
};

export default DatosGimnasio;
