// Roles que se determinan por pertenencia a un grupo de Entra ID.
export const GROUP_ROLES = ['rrhh', 'direccion', 'controlling', 'almacen', 'it', 'etica'] as const
export type GroupRole = (typeof GROUP_ROLES)[number]

// Variable de entorno con el ID del grupo de Entra ID de cada rol.
const GROUP_ENV: Record<GroupRole, string> = {
  rrhh: 'ENTRA_GROUP_RRHH',
  direccion: 'ENTRA_GROUP_DIRECCION',
  controlling: 'ENTRA_GROUP_CONTROLLING',
  almacen: 'ENTRA_GROUP_ALMACEN',
  it: 'ENTRA_GROUP_IT',
  etica: 'ENTRA_GROUP_ETICA',
}

export interface AppConfig {
  /** Autenticación simulada: solo para desarrollo en local. */
  devAuth: boolean
  /** ID de grupo de Entra ID por rol. Un rol sin grupo configurado no se asigna a nadie. */
  groupIds: Partial<Record<GroupRole, string>>
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const devAuth = env.DEV_AUTH === 'true'

  // WEBSITE_SITE_NAME lo define siempre Azure App Service: la autenticación simulada
  // nunca debe poder activarse allí, aunque alguien ponga DEV_AUTH por error.
  if (devAuth && (env.NODE_ENV === 'production' || env.WEBSITE_SITE_NAME)) {
    throw new Error('DEV_AUTH=true no está permitido en producción ni en Azure App Service.')
  }

  const groupIds: Partial<Record<GroupRole, string>> = {}
  for (const role of GROUP_ROLES) {
    const value = env[GROUP_ENV[role]]?.trim()
    if (value) {
      groupIds[role] = value
    } else if (devAuth) {
      // En local no hacen falta los grupos reales: se usan identificadores de prueba.
      groupIds[role] = `dev-group-${role}`
    }
  }

  return { devAuth, groupIds }
}
