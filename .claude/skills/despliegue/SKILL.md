---
name: despliegue
description: Cómo se despliega rrhh-mexico en Azure App Service con GitHub Actions (paquete, orden de rutas, workflow y pendientes). Úsala al tocar el despliegue, el workflow, el build de la raíz o el orden de rutas de api/src/app.ts.
---

# Cómo se despliega

Una sola aplicación: Express sirve el front compilado (`web/dist`) y la API bajo `/api`. App Service le pasa el puerto en `process.env.PORT`. El despliegue será con GitHub Actions desde `main` (organización GitHub `desarrollorevergy`).

- El **build se hace en GitHub Actions** y se sube ya compilado; App Service no compila (`SCM_DO_BUILD_DURING_DEPLOYMENT=false`) y arranca con `npm start` desde la raíz del paquete.
- El paquete desplegado lleva solo: `package.json` raíz, `api/package.json`, `api/dist`, `api/node_modules` (sin devDependencies) y `web/dist`.
- Orden de rutas en `api/src/app.ts`: rutas `/api` → 404 JSON para cualquier `/api/*` inexistente → archivos de `web/dist` → `index.html` para el resto (lo resuelve el router del front). Con Express 5 el comodín se escribe `/{*splat}`, no `*`.
- El `build` de la raíz instala `web/` y `api/` antes de compilar, porque el workflow que genera el Centro de implementación de Azure solo ejecuta `npm install`, `npm run build` y `npm run test` en la raíz.
- Workflow: `.github/workflows/main_rrhh-mexico.yml`, generado por el Centro de implementación de Azure. Se ejecuta en cada push a `main` y despliega en producción. Se autentica con un **perfil de publicación** guardado como secreto en GitHub (autenticación básica).
- **Primer despliegue hecho el 2026-11-12** (carcasa visual, sin inicio de sesión ni base de datos).
- Pendiente: recortar el paquete (hoy sube el repo entero con devDependencies, fuentes y `docs/`) y valorar pasar a identidad administrada en lugar del perfil de publicación.
