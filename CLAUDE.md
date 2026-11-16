# CLAUDE.md — Plataforma Digital RRHH · Revergy México

Este archivo da contexto a Claude Code en cada sesión. Mantenlo actualizado cuando cambie una decisión.

## Cómo trabajar en este proyecto

- Responde siempre en **español**, de forma directa.
- Trabaja en **pasos pequeños**. Antes de un cambio grande (varios archivos, nueva dependencia, cambio de estructura), explica el plan y espera confirmación.
- **No inventes reglas de negocio.** Si una regla no está en este archivo ni en `docs/`, pregunta. Las dudas abiertas están en la sección "Dudas pendientes".
- Antes de instalar una dependencia nueva, di cuál y por qué.
- Rama de trabajo: **`dev`**. Nunca hagas commit ni push directo a `main` (será lo que se publique en producción).
- Mensajes de commit en español, cortos y descriptivos.
- **Nunca** escribas secretos en el código ni en el repo. Las variables van en `.env` (ignorado por git) y se documentan en `.env.example` sin valores reales.
- El código (variables, funciones) en inglés; textos de la interfaz y comentarios de negocio en español.

## Qué es el proyecto

Portal web de Recursos Humanos para Revergy México. Sustituye a una Power App con listas de SharePoint. El documento funcional completo está en `docs/Plataforma RRHH.pdf` (léelo cuando necesites detalle de un módulo).

### Módulos (10)

| # | Módulo | Resumen |
|---|---|---|
| 01 | Parte de Horas | Fichaje diario, validación semanal por supervisor, aprobado pasa a RRHH para nómina |
| 02 | Contratación | Requisición → RRHH → Dirección → CVs → evaluación (MS Forms) → contratación |
| 03 | Solicitudes de Baja | Despido requiere Dirección; validación de adeudos (Controlling y Almacén); aviso a IT |
| 04 | Recepción de CVs | Banco de talentos; entrada por portal público y por correo |
| 05 | Onboarding | Materiales por puesto, confirmación de revisión, % de avance |
| 06 | Recibos de Nómina | RRHH sube ZIP; se envía cada PDF por correo según nº empleado o RFC |
| 07 | Ficha de Empleado | Expediente; solo RRHH edita; el colaborador ve la suya en solo lectura |
| 08 | Vacaciones / Ausentismos | Saldo por antigüedad (LFT 2023+); supervisor → RRHH; incapacidad exige documento IMSS |
| 09 | Perfiles de Puesto | Catálogo; se reutiliza en Contratación |
| 10 | Buzón de Quejas | Anónimo, sin login, folio automático; solo RRHH/Comité de Ética lo ve |

El módulo «Incremento Salarial / Puesto» del documento funcional **se retiró** el 2026-11-13 por decisión del usuario: no se construye. El Buzón pasó del número 11 al 10.

### Fases

- **Fase 0 (terminada en código el 2026-11-12):** base del proyecto: estructura, carcasa visual, autenticación (en producción), base de datos local y motor de aprobaciones genérico. En Azure la base de datos se creó el 2026-11-12 y los grupos de Entra ID para los roles ya funcionan (2026-11-13).
- **Fase 1:** Parte de Horas + Ficha de Empleado básica (lo mínimo que necesita el parte de horas). Migrar datos de la Power App.
- Después, por dependencias: Vacaciones → Bajas → Perfiles + Contratación + CVs → Onboarding → Nómina → Buzón.

## Stack técnico

| Capa | Tecnología |
|---|---|
| Front | React + Vite + TypeScript (`web/`) |
| API | Node + Express 5 + TypeScript, ESM (`"type": "module"`, `NodeNext`), `tsx` en desarrollo (`api/`) |
| Base de datos | Azure SQL Database: servidor `rrhh-mexico.database.windows.net`, base `rrhh`, creada el 2026-11-12 con la **oferta gratuita sin servidor** (32 GB y 100 000 s de núcleo al mes; al agotarse se pausa hasta el mes siguiente, sin cobro), usuario de aplicación `rrhh_app`. Aún no probada con la app desplegada. En local: **SQL Server 2025 Developer instalado en Windows** (sin Docker), base `rrhh`, usuario de SQL `rrhh_app`. Librería: `mssql`. Scripts SQL versionados en `db/migrations/` |
| Archivos | Azure Blob Storage (más adelante) |
| Correo | Microsoft Graph desde un buzón compartido (más adelante) |
| Hosting | Azure App Service Linux **`rrhh-mexico`** (grupo de recursos `rrhh-mexico_group`), Node 24 LTS, plan Básico **B1**, región **West US 3** |
| Procesos programados | Azure Functions con temporizador (más adelante: consolidado semanal, envío de nóminas) |
| Pruebas | Vitest para lógica de negocio (sobre todo cálculo de horas) |

### Despliegue

GitHub Actions despliega en producción en cada push a `main`. El detalle (paquete, orden de rutas, workflow y pendientes) está en la skill `despliegue` (`.claude/skills/despliegue/SKILL.md`).

### Base de datos

- **Migraciones:** scripts numerados en `db/migrations/` (`001_base.sql`, ...). `api/src/db/migrate.ts` aplica los pendientes en orden, cada uno en una transacción, y los anota en la tabla `schema_migrations`. Un script ya aplicado **no se edita**: los cambios van en un script nuevo. No usar `GO`.
- **Tablas actuales:** `departments`, `employees` (con `supervisor_id`), `projects` (analíticas) y `holidays`. Sin datos sensibles todavía.
- **Datos de prueba:** `api/src/db/seed.ts` crea un empleado por cada usuario de prueba de `devUsers.ts`. No se ejecuta sin `DEV_AUTH=true`.
- **Enlace usuario ↔ empleado:** por **correo** (confirmado el 2026-11-13). La columna `entra_object_id` queda reservada, sin uso.
- **Sin base de datos configurada** (`DB_SERVER` vacío, como hoy en Azure) la API arranca igual y nadie es Supervisor.
- **Pruebas:** las de base de datos corren contra la base local y se omiten donde no hay `DB_SERVER` (GitHub Actions).
- **Instalación local:** SQL Server viene con TCP/IP desactivado y solo autenticación de Windows; hay que activar TCP/IP (puerto 1433) y el modo mixto, y crear la base y el usuario de la aplicación. La contraseña vive solo en `api/.env`.

## Autenticación y autorización

- En producción: **Autenticación de App Service ("Easy Auth")** con Microsoft Entra ID (cuentas M365 de Revergy). App Service entrega el usuario autenticado en la cabecera **`X-MS-CLIENT-PRINCIPAL`** (JSON en base64 con los claims, incluidos los grupos).
- En local: un **middleware de desarrollo** simula esa cabecera con un usuario de prueba. Debe haber un selector de usuario/rol en la interfaz **solo en desarrollo** para probar las vistas de cada rol. El código de negocio no debe saber si el usuario es real o simulado.
- **Toda la autorización se comprueba en la API**, nunca solo en el front. El front solo oculta lo que no corresponde.
- Un colaborador solo puede ver y modificar **sus propios** datos. Un supervisor, los de **su equipo**.

### Cómo está implementado

- **Producción:** Easy Auth está **activo** desde el 2026-11-12 (proveedor Microsoft, inquilino único, "Requerir autenticación", no autenticados → redirección 302). El registro de aplicación `rrhh-mexico` tiene un **secreto de cliente que caduca**: hay que renovarlo antes o el inicio de sesión deja de funcionar.
- **API** (`api/src/auth/`): `principal.ts` decodifica la cabecera; `roles.ts` calcula los roles; `middleware.ts` tiene `authenticate` (401), `requireRole` (403) y `getAuth(res)` para leer el usuario en una ruta. Todo `/api` exige usuario salvo `/api/health`. `GET /api/me` devuelve usuario y roles.
- **Local:** `DEV_AUTH=true` en `api/.env` activa `devAuth`, que fabrica la cabecera real a partir del usuario de prueba elegido (cabecera `X-Dev-User`). Usuarios ficticios en `api/src/auth/devUsers.ts`. La API **no arranca** con `DEV_AUTH=true` si detecta producción o Azure (`WEBSITE_SITE_NAME`).
- **Front** (`web/src/auth/`): `AuthProvider` carga `/api/me` antes de mostrar la app; `useAuth()` da el usuario. El selector `web/src/dev/DevUserSwitcher.tsx` solo se carga con `import.meta.env.DEV`.
- **Ficha automática (2026-11-13):** quien entra al Parte de Horas sin ficha recibe una básica en ese momento (`ensureEmployee` en `api/src/db/employees.ts`): nombre y correo de su cuenta, número provisional `AUTO-<id>`, sin supervisor ni departamento. Puede fichar enseguida, pero **sus semanas no las puede validar nadie salvo el administrador** hasta que RRHH le asigne supervisor. Una ficha dada de baja no se reactiva sola. Cualquier cuenta M365 del inquilino que entre al módulo genera ficha.
- **Supervisor "por datos":** sale de la tabla `employees` (`api/src/db/employees.ts`): lo es quien tiene empleados activos con su `supervisor_id`. En producción nadie lo es hasta que exista la base de datos en Azure.
- **Roles en producción:** los grupos de Entra ID están creados y funcionando (confirmado por el usuario el 2026-11-13), con la base de datos conectada desde ese día.
- **Pendiente:** el menú de módulos aún no se filtra por rol.

### Roles

| Rol | Cómo se determina |
|---|---|
| Colaborador | Cualquier empleado autenticado |
| Supervisor / Responsable | **Por datos**: tiene empleados a su cargo en la ficha de empleado |
| Administrador | Grupo de Entra ID (`ENTRA_GROUP_ADMIN`) |
| RRHH | Grupo de Entra ID |
| Dirección General | Grupo de Entra ID |
| Controlling | Grupo de Entra ID |
| Almacén | Grupo de Entra ID |
| IT / Sistemas | Grupo de Entra ID |
| Comité de Ética | Grupo de Entra ID |

Los nombres de grupos e IDs se configuran por variables de entorno, nunca en el código.

### Administrador (confirmado el 2026-11-13)

Entra a todos los módulos y **actúa**: hace lo mismo que RRHH y que el supervisor de cualquier empleado. Todo queda en el historial con su nombre.

**Es un rol para mostrar el software, no parte del flujo real** (aclarado por el usuario el 2026-11-13): cuando la app esté en uso, el administrador no participará en ningún flujo de aprobación. No diseñar reglas de negocio que dependan de él ni ampliar lo que puede hacer.

- **Límites:** no decide sobre sus propias solicitudes (su parte de horas lo valida su supervisor) y, como administrador, **no** tendrá acceso al Buzón de Quejas. Sí podrá verlo con el selector «Ver como» en los roles RRHH o Comité de Ética (confirmado el 2026-11-13).
- **Necesita ficha de empleado** para fichar y para validar partes de horas (las decisiones se guardan a nombre de un empleado). Sin ficha sí puede entrar a «Ficha de Empleado» y darse de alta.
- **Implementación:** `isAdmin` en `api/src/auth/roles.ts`. `requireRole` lo deja pasar siempre; en supervisión alcanza a todos menos a sí mismo (`scopeSql` en `api/src/timesheet/team.ts`); en el motor de aprobaciones encaja con cualquier aprobador (`matches` en `stateMachine.ts`). En el front, `hasRole` (`web/src/auth/authContext.ts`). Usuario de prueba: `dev-admin`.
- **Selector «Ver como»:** en la cabecera, solo para administradores (`web/src/layout/RoleSwitcher.tsx`). Elige un rol y pasa a tener **solo** ese rol más Colaborador, en pantallas y en permisos; sigue siendo él (su nombre en el historial), no suplanta a otra persona. El front envía la cabecera `X-View-As-Role` y la API recorta los roles (`viewAs` en `api/src/auth/roles.ts`) solo si es administrador de verdad. «Supervisor» alcanza solo a su equipo directo. `/api/me` devuelve `isAdmin` y `viewAs`.
- **Al construir el Buzón:** no usar `requireRole` ni `hasRole`, porque dejarían entrar al administrador sin haber elegido rol.
- **A confirmar:** en el motor el administrador puede dar también las aprobaciones de Dirección, Controlling y Almacén. Hoy no tiene efecto (esos módulos no existen); revisarlo al construir Contratación y Bajas.

## Diseño (sistema corporativo Revergy)

- Colores: azul **#456099**, verde **#71a971**, gris **#393536**, gradiente verde → azul.
- Tipografía: **Inter**.
- Logo de Revergy en la cabecera.
- Limpio, **responsive** (el fichaje se usa sobre todo desde el **móvil**) y con **modo claro/oscuro**.
- Los colores se definen como variables CSS (tokens) en un único lugar.
- Carcasa común: cabecera y área de contenido. **Sin menú lateral**: el menú es la pantalla de inicio «Módulos de la Plataforma», una rejilla de tarjetas igual a la pantalla `homeModulos` de la Power App (1/2/3 columnas según el ancho). El logo de la cabecera vuelve al inicio. Los módulos se declaran en `web/src/navigation/modules.ts`; los no construidos se muestran como «Próximamente».

## Motor de aprobaciones (genérico)

Los módulos 01, 02, 03 y 08 comparten el patrón "solicitud → uno o varios aprobadores → resultado". Se implementa **una vez** y se reutiliza:

- Estados de una solicitud y transiciones permitidas.
- Cadena de aprobadores por tipo de solicitud (ej. supervisor → RRHH; RRHH → Dirección).
- Historial completo: quién, cuándo, qué decisión y **motivo** (obligatorio al rechazar).
- Punto de enganche para notificaciones (el envío de correo real llegará después).
- **Solicitud propia (confirmado el 2026-11-13):** quien tiene el rol aprobador de un paso (RRHH, Dirección, Controlling, Almacén) puede aprobar o rechazar también su propia solicitud. El paso de supervisor nunca lo decide uno mismo: el parte de horas propio lo valida su supervisor.

### Cómo está implementado

En `api/src/approvals/`; el detalle está en `api/src/approvals/CLAUDE.md`, que se carga al trabajar en esa carpeta.

## Módulo 01 — Parte de Horas (Fase 1, en pausa desde el 2026-11-16)

Es el módulo que se presentará como terminado. Debe quedar **igual que la app desplegada pero adaptado** a esta arquitectura.

### Dónde se quedó (2026-11-16)

Por decisión del usuario se deja aquí para avanzar con los demás módulos. Etapas 1 a 8 hechas en código; para retomarlo, en este orden:

1. **Etapa 9**, sin empezar: orden de trabajo adjunta (Azure Blob) y avisos push al rechazar.
2. **Etapa 10**: cargar los empleados reales en producción (base de datos, migraciones y grupos de roles ya funcionan).
3. Probar la PWA (etapa 8) en un teléfono real y con Easy Auth en producción; necesita la etapa 8 desplegada.
4. Validar el formato del CSV de nómina con quien hace la nómina.
5. Pantalla de mantenimiento de analíticas para Controlling.

Al pausar, `main` (producción) llegaba hasta el rol Administrador: le faltaban la ficha automática y las etapas 7 y 8, que estaban solo en `dev`.

### Referencia existente

- **`../portal-recursos-humanos`: la app de parte de horas ya desplegada** (React + Vite + Supabase, PWA con fichaje sin conexión). Es la referencia de comportamiento e interfaz: fichaje, «Mi semana», panel de supervisión con rechazo por días, panel de RRHH con CSV, orden de trabajo adjunta y avisos push. Tiene manuales en `manual/`.
- `../parte-horas`: prototipo anterior, más simple.
- **No** usar Supabase: los datos van por nuestra API y Azure SQL. **No** copiar `.env.local` ni ninguna clave.

### Decisiones (2026-11-12)

- **Cálculo de horas:** el del documento funcional, no el de la app desplegada (ver «Reglas de cálculo»).
- **Tipos de jornada:** solo Activa / Inactiva (la app desplegada tiene cuatro).
- **Sin conexión, mixto:** con red la hora la pone el servidor; sin red el fichaje se guarda en el teléfono con la hora del dispositivo, se sube al reconectar y queda marcado como «fichado sin conexión».
- **Datos:** se empezó limpio. Desde el 2026-11-13 hay un importador de la app anterior (ver «Importar datos de la app anterior»).
- **Se conserva de la app desplegada:** rechazo **por días** (el supervisor marca los días con problema; el colaborador corrige solo esos y reenvía), corrección de jornadas por el supervisor con historial, comentario por jornada, orden de trabajo adjunta, avisos push al rechazar, CSV de nómina.
- **Medianoche:** una jornada abierta sigue siendo la activa hasta las 08:00 del día siguiente y cuenta para el día de la entrada. Si se cerró de madrugada, se sigue mostrando hasta las 08:00 y hasta entonces no se puede fichar la de hoy (igual que la app desplegada).
- **Zona horaria:** el dispositivo envía su zona (IANA) en cada petición y el servidor calcula con ella el día de la jornada; la hora la pone siempre el servidor y se guarda en UTC. Revergy tiene sedes en zonas distintas (Sonora va una hora por detrás del centro).
- **Módulos sin base de datos:** `/api/me` devuelve `hasDatabase`; si es `false` (como hoy en producción) todas las tarjetas siguen en «Próximamente».
- **Fichaje olvidado:** lo corrige el supervisor (o el colaborador si le rechazan el día).
- **Festivos:** calendario en la tabla `holidays`, mantenido por RRHH desde la app. Ya no los marca el supervisor a mano.
- **GPS:** no se captura.
- **Catálogo de analíticas:** lo mantiene **Controlling**. La carga inicial va por migración; falta la pantalla para que Controlling añada, renombre y desactive analíticas.
- **Cambios por arquitectura:** el supervisor ve solo a su equipo (`supervisor_id`), no por departamento; RRHH solo ve semanas aprobadas.

### Etapas

1. Datos y catálogos — **hecha**: catálogo de 68 analíticas, administración de empleados y festivos para RRHH (`/empleados`, tarjeta 07 visible solo para RRHH; API en `api/src/admin/`).
   Pendiente de esta etapa: pantalla de mantenimiento de analíticas para Controlling.
2. Cálculo de horas — **hecha**: `api/src/timesheet/hours.ts` (funciones puras, en minutos completos; `calculateWeek` da el consolidado).
3. Fichaje con conexión — **hecha**.
4. Mi semana — **hecha**.
5. Supervisión — **hecha**.
6. Corrección y reenvío — **hecha**.
7. RRHH: semanas aprobadas y CSV de nómina — **hecha**. **El formato del CSV no está validado con quien hace la nómina.**
8. Sin conexión (PWA) — **hecha en código el 2026-11-13; falta probarla en un teléfono real y con Easy Auth en producción.**
9. Orden de trabajo (Azure Blob) y avisos push.
10. Producción: Azure SQL, migraciones en el despliegue, grupos de roles, empleados reales.

El detalle de las etapas 3 a 8 (rutas, tablas y reglas confirmadas) está en `api/src/timesheet/CLAUDE.md`, que se carga al trabajar en esa carpeta. **Léelo antes de cambiar pantallas del Parte de Horas en `web/`.**

### Importar datos de la app anterior

**`data/` tiene datos personales reales (RFC, correos personales) y está en `.gitignore`: nunca se sube.** El importador (`api/src/db/importLegacy.ts`), sus comandos y sus reglas están en la skill `importar-app-anterior` (`.claude/skills/importar-app-anterior/SKILL.md`).

### Datos que registra el colaborador cada día

1. **Analítica / Proyecto** (catálogo, obligatorio).
2. **Tipo de jornada**: Activa / Inactiva.
3. **Aplicar dieta**: sí/no (viáticos de alimentación; va a nómina).
4. **Hora de entrada / salida**: la captura el sistema al pulsar «Fichar entrada» / «Fichar salida» (hora del servidor, no del dispositivo).

### Flujo

1. Colaborador elige proyecto, tipo de jornada y dieta → «Fichar entrada».
2. La app queda en espera: solo muestra «Fichar salida».
3. «Fichar salida» → registro del día completado. **Un solo registro por día.**
4. El sistema calcula las horas del día y, al completar la semana, genera el **consolidado semanal**: H. Normal, H. Extra, H. Domingo, Festivo, Dietas y Total.
5. El supervisor ve el consolidado de su equipo (filtros: periodo, estado, persona) y el detalle día por día.
6. **Rechazar** exige motivo → la semana vuelve al colaborador para corregir.
7. **Aceptar** → pasa automáticamente a RRHH con estado «Aprobado».
8. RRHH solo ve semanas **aprobadas**, con el detalle listo para nómina.

### Reglas de cálculo (según el documento)

| Tipo | Regla |
|---|---|
| H. Normal | Lunes a viernes no festivo, hasta 8 h por día |
| H. Extra | Lo que pase de 8 h en esos días, más **todas** las horas del sábado |
| H. Domingo | Todas las horas del domingo |
| Festivo | Todas las horas de un día del calendario de festivos, caiga en el día que caiga |
| Dietas | Número de días con dieta marcada, validado por supervisor |

Interpretación confirmada el 2026-11-12: con el tope de 8 h diarias de lunes a viernes nunca se superan las 40 h semanales, así que las dos condiciones del documento no se solapan. Además: **sin redondeo** (tiempo exacto), **no se descuenta comida** (horas = salida − entrada) y la jornada **Inactiva** cuenta igual que la Activa (el tipo se muestra y se exporta).

El colaborador **no** puede reportar horas extra a mano: se calculan.
Implementa el cálculo como **funciones puras con pruebas Vitest**, separadas de la base de datos y de Express.

### Validaciones

1. Un solo registro por día.
2. Proyecto obligatorio antes de fichar entrada.
3. Secuencia entrada → salida (no se puede fichar salida sin entrada).
4. Horas extra solo calculadas, nunca manuales.
5. Rechazo con motivo obligatorio.
6. RRHH solo ve registros «Aprobado».

### Permisos

| Rol | Puede |
|---|---|
| Colaborador | Fichar, elegir proyecto y jornada, marcar dieta, editar registros **rechazados** |
| Supervisor | Ver consolidado de su equipo, detalle por día, aceptar / rechazar con motivo |
| RRHH | Ver aprobados, detalle para nómina, reportes de horas y dietas |
| Dirección | Sin acceso a este módulo |

## Módulo 08 — Vacaciones / Ausentismos (en curso desde el 2026-11-16)

### Reglas confirmadas (2026-11-16)

- **Tipos:** por ahora solo **vacaciones** e **incapacidad**. Los demás tipos de ausencia se añadirán después.
- **Flujo:** supervisor → RRHH para todos los tipos, también la incapacidad (pasa por los dos «para conocimiento»). El rechazo es definitivo (documento funcional).
- **Sin supervisor:** la solicitud va directa a RRHH.
- **Fecha de ingreso:** está en la ficha (`employees.hire_date`, migración 008); la captura RRHH. Sin ella no hay saldo.
- **Saldo:** se calcula desde la fecha de ingreso con la tabla LFT 2023+ (12, 14, 16, 18, 20 y luego +2 cada cinco años); no hay carga de saldo inicial. RRHH puede ajustar saldos a mano.
- **Año de servicio:** el año se cuenta por **aniversario de ingreso**, no por año natural. El año 1 va del ingreso al primer aniversario y sus 12 días están disponibles **completos desde el primer día** (no proporcionales).
- **Caducidad:** los días no usados caducan al llegar el aniversario; no se acumulan.
- **Qué días cuentan:** días laborables, de **lunes a sábado** sin festivos del calendario; no hay medios días.
- **Interpretación aplicada, sin confirmar expresamente:** el año de servicio *n* da los días de la fila *n* de la tabla (año 2 → 14); cada día se descuenta del año de servicio en el que cae, así que una solicitud que cruza el aniversario se reparte entre los dos; quien ingresó un 29 de febrero cumple el 28 en años no bisiestos.
- **Reserva:** los días de una solicitud pendiente quedan reservados y no se pueden volver a pedir.
- **Cancelar:** el colaborador cancela sus solicitudes pendientes. Una ya aprobada solo la cancela **RRHH**, y devuelve el saldo.
- **Fechas pasadas:** permitidas en la incapacidad.
- **Incapacidad:** exige el documento del IMSS (necesita Azure Blob Storage, aún sin montar).
- **Parte de Horas:** por ahora separados. Más adelante, unas vacaciones aprobadas impedirán fichar esos días y los cargarán solos con la etiqueta de vacaciones.

### Etapas

1. Datos — **hecha**: fecha de ingreso en la ficha (migración 008) y tablas `absence_requests`, `absence_days` y `vacation_adjustments` (migración 009).
2. Cálculo de saldo — **hecha**: `api/src/absences/balance.ts` (funciones puras con pruebas).
3. Colaborador: saldo, crear solicitud, cancelar pendientes, historial.
4. Supervisor: solicitudes de su equipo.
5. RRHH: aprobación final, ver todas, ajustar saldos, cancelar aprobadas.
6. Incapacidad con documento IMSS (Azure Blob Storage).

## Dudas pendientes (no decidir sin confirmar)

Las dudas 1 a 7 y la 10 (sábado, umbral de extra, festivos, fichaje olvidado, ubicación, medianoche, sin conexión y redondeo) quedaron resueltas el 2026-11-12; están en la sección del módulo 01. La 8 (rol SuperAdmin) se resolvió el 2026-11-13 con el rol Administrador. La 9 (identificación del empleado) se resolvió el 2026-11-13: enlace por correo. La 11 (aprobar la propia solicitud) también: sí se puede con el rol aprobador (ver «Motor de aprobaciones»). Se conserva la numeración. No quedan dudas abiertas.

Cuando se resuelva una duda, muévela a la sección correspondiente como regla.

## Datos sensibles

Se manejan datos personales (CURP, RFC, NSS, salario, incapacidades). Aplica la ley mexicana de protección de datos (LFPDPPP):
- Mínimo acceso: cada rol ve solo lo necesario.
- No registrar datos personales en logs.
- El buzón anónimo no debe guardar ni registrar identidad, correo ni IP.

## Decisiones tomadas (registro)

- Hosting en **App Service** (no Static Web App). La SWA anterior se eliminó.
- Región **West US 3** (confirmada; antes se preveía Mexico Central). La base de datos irá en la misma región que la app.
- El repositorio de GitHub es **privado**.
- Base de datos **Azure SQL**, no listas de SharePoint ni Supabase. Se valoró PostgreSQL el 2026-11-12 y se mantuvo SQL Server.
- En local, SQL Server **instalado en Windows**, no en Docker (Docker Desktop no se instaló).
- Front con framework (React) por la complejidad: 10 módulos y vistas por rol.
- Las partes públicas (buzón anónimo, portal de postulantes) irán separadas de la app principal; se decidirá cómo al llegar a esos módulos.