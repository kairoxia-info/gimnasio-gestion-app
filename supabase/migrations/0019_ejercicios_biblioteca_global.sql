-- Biblioteca de ejercicios global y compartida entre TODOS los gimnasios.
--
-- Hasta acá, "Importar biblioteca base" copiaba los 500 ejercicios curados
-- (lib/biblioteca_ejercicios_base.js) DENTRO del gimnasio que apretaba el
-- botón: cada gimnasio nuevo iba a terminar con su propia copia repetida de
-- los mismos 500 registros. Pedido de Nalux (03/09/2026): que exista una
-- sola copia compartida por todos, visible para cualquier gimnasio con solo
-- loguearse (sin botón, sin duplicar filas), reservando "gimnasio_id" solo
-- para los ejercicios que cada gimnasio carga por su cuenta -- y que esos de
-- la biblioteca no se puedan editar/borrar (si uno lo edita, se editaría
-- para todos los demás gimnasios).
--
-- Un ejercicio "de la biblioteca" se modela como gimnasio_id = NULL (nadie
-- es dueño, todos lo pueden ver). RLS se separa en política de SELECT
-- (propio del gimnasio O global) vs. política de escritura (INSERT/UPDATE/
-- DELETE siguen exigiendo gimnasio_id = get_mi_gimnasio_id()) -- eso ya deja
-- afuera cualquier intento de editar/borrar una fila con gimnasio_id NULL,
-- porque NULL nunca es igual al id de ningún gimnasio real.

alter table ejercicios alter column gimnasio_id drop not null;

drop policy if exists ejercicios_tenant_isolation on ejercicios;

create policy ejercicios_select on ejercicios
    for select
    using (gimnasio_id = get_mi_gimnasio_id() or gimnasio_id is null);

create policy ejercicios_insert on ejercicios
    for insert
    with check (gimnasio_id = get_mi_gimnasio_id());

create policy ejercicios_update on ejercicios
    for update
    using (gimnasio_id = get_mi_gimnasio_id())
    with check (gimnasio_id = get_mi_gimnasio_id());

create policy ejercicios_delete on ejercicios
    for delete
    using (gimnasio_id = get_mi_gimnasio_id());

-- Convierte los 500 ejercicios ya importados (todos con media_url del
-- dataset free-exercise-db) en globales (origen='global', ya contemplado
-- por el CHECK de la columna). Los 4 ejercicios propios de Nalux (Peso
-- Muerto, Búlgara, Sentadilla Frontal, Press Frances -- ninguno usa esa
-- URL) quedan como estaban, editables solo por su gimnasio.
update ejercicios
set gimnasio_id = null, origen = 'global'
where media_url like 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/%';
