import {
  Calendar,
  CircleDollarSign,
  Clock,
  FileText,
  List,
  LogOut,
  MapPin,
  MessageSquare,
  TrendingUp,
  User,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'
import type { Role } from '../auth/authContext.ts'

export interface AppModule {
  num: string
  title: string
  description: string
  icon: LucideIcon
  /** Ruta del módulo dentro de la app. */
  path: string
  /** false = aún no construido: la tarjeta avisa «próximamente» y no navega. */
  available: boolean
  /** Roles para los que el módulo ya está disponible aunque `available` sea false. */
  availableFor?: Role[]
}

/** ¿Puede entrar ya este usuario al módulo? La API vuelve a comprobarlo. */
export function isModuleAvailable(module: AppModule, user: { roles: Role[]; hasDatabase: boolean }): boolean {
  // Sin base de datos en el servidor ningún módulo puede funcionar todavía.
  if (!user.hasDatabase) return false
  return module.available || (module.availableFor?.some((role) => user.roles.includes(role)) ?? false)
}

// Catálogo de los 11 módulos (numeración de CLAUDE.md).
export const MODULES: AppModule[] = [
  {
    num: '01',
    title: 'Parte de Horas',
    description: 'Registro diario de fichaje con validación semanal del supervisor.',
    icon: Clock,
    path: '/parte-horas',
    available: true,
  },
  {
    num: '02',
    title: 'Contratación',
    description: 'Proceso de reclutamiento, de la requisición a la contratación.',
    icon: UserPlus,
    path: '/contratacion',
    available: false,
  },
  {
    num: '03',
    title: 'Solicitudes de Baja',
    description: 'Desvinculación con validación de adeudos y encuesta de salida.',
    icon: LogOut,
    path: '/bajas',
    available: false,
  },
  {
    num: '04',
    title: 'Recepción de CVs',
    description: 'Currículos centralizados y vinculados a las vacantes activas.',
    icon: FileText,
    path: '/cvs',
    available: false,
  },
  {
    num: '05',
    title: 'Onboarding',
    description: 'Inducción digital con seguimiento de progreso.',
    icon: MapPin,
    path: '/onboarding',
    available: false,
  },
  {
    num: '06',
    title: 'Recibos de Nómina',
    description: 'Distribución automatizada de recibos por correo electrónico.',
    icon: CircleDollarSign,
    path: '/nomina',
    available: false,
  },
  {
    num: '07',
    title: 'Ficha de Empleado',
    description: 'Expediente digital del colaborador, gestionado por RRHH.',
    icon: User,
    path: '/empleados',
    available: false,
    // De momento solo la administración básica de RRHH (alta de empleados y festivos).
    availableFor: ['rrhh'],
  },
  {
    num: '08',
    title: 'Vacaciones / Ausentismos',
    description: 'Solicitudes de ausencia con control de saldo de vacaciones.',
    icon: Calendar,
    path: '/vacaciones',
    available: false,
  },
  {
    num: '09',
    title: 'Perfiles de Puesto',
    description: 'Catálogo con fichas descriptivas de todos los puestos.',
    icon: List,
    path: '/perfiles',
    available: false,
  },
  {
    num: '10',
    title: 'Incremento Salarial / Puesto',
    description: 'Solicitudes de incremento de salario y/o cambio de puesto con flujo de aprobación.',
    icon: TrendingUp,
    path: '/incrementos',
    available: false,
  },
  {
    num: '11',
    title: 'Buzón de Quejas',
    description: 'Canal confidencial y anónimo para quejas y sugerencias.',
    icon: MessageSquare,
    path: '/buzon',
    available: false,
  },
]
