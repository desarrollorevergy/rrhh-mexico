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

Portal web de Recursos Humanos para Revergy México. Sustituye a una Power App con listas de SharePoint. El documento funcional completo está en `docs/Plataforma-Digital-RRHH.pdf` (léelo cuando necesites detalle de un módulo).

### Módulos (11)

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
| 10 | Incremento Salarial / Puesto | Colaborador → supervisor → RRHH; actualiza la ficha |
| 11 | Buzón de Quejas | Anónimo, sin login, folio automático; solo RRHH/Comité de Ética lo ve |

### Fases

- **Fase 0 (actual):** base del proyecto: estructura, carcasa visual, autenticación simulada en local, base de datos local, motor de aprobaciones genérico.
- **Fase 1:** Parte de Horas + Ficha de Empleado básica (lo mínimo que necesita el parte de horas). Migrar datos de la Power App.
- Después, por dependencias: Vacaciones e Incremento → Bajas → Perfiles + Contratación + CVs → Onboarding → Nómina → Buzón.

## Stack técnico

| Capa | Tecnología |
|---|---|
| Front | React + Vite + TypeScript (`web/`) |
| API | Node + Express 5 + TypeScript, ESM (`"type": "module"`, `NodeNext`), `tsx` en desarrollo (`api/`) |
| Base de datos | Azure SQL Database. En local: SQL Server en Docker. Librería: `mssql`. Scripts SQL versionados en `db/` |
| Archivos | Azure Blob Storage (más adelante) |
| Correo | Microsoft Graph desde un buzón compartido (más adelante) |
| Hosting | Azure App Service, Linux, Node 24 LTS, región Mexico Central. **Aún no creado** (pendiente de suscripción de Revergy) |
| Procesos programados | Azure Functions con temporizador (más adelante: consolidado semanal, envío de nóminas) |
| Pruebas | Vitest para lógica de negocio (sobre todo cálculo de horas) |

### Cómo se despliega (futuro)

Una sola aplicación: Express sirve el front compilado (`web/dist`) y la API bajo `/api`. App Service le pasa el puerto en `process.env.PORT`. El despliegue será con GitHub Actions desde `main` (organización GitHub `desarrollorevergy`).

### Estructura del repo

```
rrhh-mexico/
├── CLAUDE.md
├── .gitignore
├── web/          # React + Vite + TS
├── api/          # Express + TS
│   └── src/server.ts
├── db/           # scripts SQL (migraciones numeradas: 001_..., 002_...)
└── docs/         # documento funcional y decisiones
```

### Comandos

```powershell
# API (puerto 3000)
cd api; npm run dev
# Front (puerto 5173, con proxy /api -> localhost:3000)
cd web; npm run dev
# Comprobación
# http://localhost:5173/api/health
```

## Autenticación y autorización

- En producción: **Autenticación de App Service ("Easy Auth")** con Microsoft Entra ID (cuentas M365 de Revergy). App Service entrega el usuario autenticado en la cabecera **`X-MS-CLIENT-PRINCIPAL`** (JSON en base64 con los claims, incluidos los grupos).
- En local: un **middleware de desarrollo** simula esa cabecera con un usuario de prueba. Debe haber un selector de usuario/rol en la interfaz **solo en desarrollo** para probar las vistas de cada rol. El código de negocio no debe saber si el usuario es real o simulado.
- **Toda la autorización se comprueba en la API**, nunca solo en el front. El front solo oculta lo que no corresponde.
- Un colaborador solo puede ver y modificar **sus propios** datos. Un supervisor, los de **su equipo**.

### Roles

| Rol | Cómo se determina |
|---|---|
| Colaborador | Cualquier empleado autenticado |
| Supervisor / Responsable | **Por datos**: tiene empleados a su cargo en la ficha de empleado |
| RRHH | Grupo de Entra ID |
| Dirección General | Grupo de Entra ID |
| Controlling | Grupo de Entra ID |
| Almacén | Grupo de Entra ID |
| IT / Sistemas | Grupo de Entra ID |
| Comité de Ética | Grupo de Entra ID |

Los nombres de grupos e IDs se configuran por variables de entorno, nunca en el código.

## Diseño (sistema corporativo Revergy)

- Colores: azul **#456099**, verde **#71a971**, gris **#393536**, gradiente verde → azul.
- Tipografía: **Inter**.
- Logo de Revergy en la cabecera.
- Limpio, **responsive** (el fichaje se usa sobre todo desde el **móvil**) y con **modo claro/oscuro**.
- Los colores se definen como variables CSS (tokens) en un único lugar.
- Carcasa común: cabecera y área de contenido. **Sin menú lateral**: el menú es la pantalla de inicio «Módulos de la Plataforma», una rejilla de tarjetas igual a la pantalla `homeModulos` de la Power App (1/2/3 columnas según el ancho). El logo de la cabecera vuelve al inicio. Los módulos se declaran en `web/src/navigation/modules.ts`; los no construidos se muestran como «Próximamente».

## Motor de aprobaciones (genérico)

Los módulos 01, 02, 03, 08 y 10 comparten el patrón "solicitud → uno o varios aprobadores → resultado". Se implementa **una vez** y se reutiliza:

- Estados de una solicitud y transiciones permitidas.
- Cadena de aprobadores por tipo de solicitud (ej. supervisor → RRHH; RRHH → Dirección).
- Historial completo: quién, cuándo, qué decisión y **motivo** (obligatorio al rechazar).
- Punto de enganche para notificaciones (el envío de correo real llegará después).

## Módulo 01 — Parte de Horas (Fase 1)

### Referencia existente

En `../parte-horas` hay un **prototipo web** del módulo (React + Vite + Tailwind + Supabase, con `db.sql`). Se puede **reutilizar** la interfaz y la lógica, pero:
- **No** usar Supabase: los datos van por nuestra API y Azure SQL.
- **No** copiar `.env.local` ni ninguna clave.

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
| H. Normal | Lunes a viernes, hasta 40 h semanales |
| H. Extra | Al superar 8 h/día o 40 h/semana (entre semana) |
| H. Domingo | Todas las horas del domingo cuentan como extra |
| Festivo | Todas las horas en festivo oficial cuentan como extra |
| Dietas | Según marca del colaborador, validado por supervisor |

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

## Dudas pendientes (no decidir sin confirmar)

1. **Sábado:** el flujo dice que cuenta como extra, pero la tabla de tipos no tiene categoría para el sábado.
2. **Umbral de extra:** cómo se combinan "más de 8 h/día" y "más de 40 h/semana" cuando coinciden (evitar contar dos veces).
3. **Festivos:** quién mantiene el calendario (¿RRHH desde la app?).
4. **Fichaje olvidado:** qué pasa si alguien no ficha la salida (¿cierre automático?, ¿corrige el supervisor?).
5. **Ubicación:** el detalle semanal muestra "ubicación". ¿Se captura GPS al fichar? (Implicaciones de privacidad.)
6. **Jornada que cruza medianoche:** ¿a qué día se imputa?
7. **Fichaje sin conexión:** la Power App guarda fichajes en una cola local y los sincroniza después. Choca con "hora del servidor". ¿Se necesita?
8. **Rol SuperAdmin:** existe en la Power App (lista `MatrizRoles`) y no en la tabla de roles de este archivo.
9. **Identificación del empleado:** ¿se enlaza el usuario de Entra ID con la ficha por correo (como la Power App) o por ID de objeto de Entra?
10. **Redondeo a medias horas:** el prototipo `parte-horas` redondea las horas del día a .0/.5. ¿Es una regla real?

Cuando se resuelva una duda, muévela a la sección correspondiente como regla.

## Datos sensibles

Se manejan datos personales (CURP, RFC, NSS, salario, incapacidades). Aplica la ley mexicana de protección de datos (LFPDPPP):
- Mínimo acceso: cada rol ve solo lo necesario.
- No registrar datos personales en logs.
- El buzón anónimo no debe guardar ni registrar identidad, correo ni IP.

## Decisiones tomadas (registro)

- Hosting en **App Service** (no Static Web App). La SWA anterior se eliminó.
- Base de datos **Azure SQL**, no listas de SharePoint ni Supabase.
- Front con framework (React) por la complejidad: 11 módulos y vistas por rol.
- Las partes públicas (buzón anónimo, portal de postulantes) irán separadas de la app principal; se decidirá cómo al llegar a esos módulos.