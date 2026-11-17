---
name: importar-app-anterior
description: Importador de empleados y registros de la app anterior de parte de horas (Supabase) a la base de datos, en local o en producción, con sus reglas confirmadas. Úsala al ejecutar o modificar api/src/db/importLegacy.ts.
---

# Importar datos de la app anterior

`api/src/db/importLegacy.ts` lleva a la base de datos los empleados y registros exportados de Supabase: `data/users_rows.csv` y `data/registros_tiempos_rows.csv`. **`data/` tiene datos personales reales (RFC, correos personales) y está en `.gitignore`: nunca se sube.**

```powershell
cd api; npm run db:import-legacy              # simulación contra la base local: no guarda nada
cd api; npm run db:import-legacy -- --apply   # guarda
# Contra producción: conexión en api/.env.produccion (ignorado por git)
cd api; npx tsx --env-file=.env.produccion src/db/importLegacy.ts [--apply]
```

- Por defecto **simula**: hace todo en una transacción y la deshace. El informe solo lleva recuentos.
- Se puede repetir: no duplica empleados (por correo) ni jornadas (por persona y día). Sirve para traer lo que se siga fichando en la app anterior hasta apagarla.
- **Reglas confirmadas el 2026-11-13:** solo usuarios con correo de empresa; sin RFC ni correo personal; número provisional `MIG-<id>`; sin supervisor (lo asigna RRHH); todo tipo de jornada antiguo pasa a Activa; las analíticas que falten se añaden sin nombre; fuera los registros de cuentas que no están en usuarios. Los registros dudosos (muy cortos, muy largos, sin salida) entran como están para que el supervisor los revise.
- No se importan las órdenes de trabajo adjuntas (etapa 9) ni el historial de aprobaciones: el estado y el motivo de rechazo van en la propia jornada.
- Con el archivo del 2026-11-13: 48 empleados, 7 departamentos y 311 jornadas (12 fuera, de 2 cuentas desconocidas).
