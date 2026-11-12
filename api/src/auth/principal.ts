import type { AuthUser } from './types.js'

/** Cabecera que entrega la autenticación de App Service (Easy Auth): JSON en base64. */
export const PRINCIPAL_HEADER = 'x-ms-client-principal'

// Entra ID puede enviar cada dato con el nombre corto o con el nombre largo del claim.
const ID_CLAIMS = ['http://schemas.microsoft.com/identity/claims/objectidentifier', 'oid']
const NAME_CLAIMS = ['name']
const EMAIL_CLAIMS = [
  'preferred_username',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn',
  'email',
  'upn',
]
const GROUP_CLAIMS = ['groups', 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups']

interface Claim {
  typ: string
  val: string
}

function isClaim(value: unknown): value is Claim {
  if (typeof value !== 'object' || value === null) return false
  const claim = value as Record<string, unknown>
  return typeof claim.typ === 'string' && typeof claim.val === 'string'
}

/** Decodifica la cabecera X-MS-CLIENT-PRINCIPAL. Devuelve null si falta o no es válida. */
export function parsePrincipal(header: string | undefined): AuthUser | null {
  if (!header) return null

  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
  } catch {
    return null
  }

  if (typeof decoded !== 'object' || decoded === null) return null
  const rawClaims = (decoded as Record<string, unknown>).claims
  if (!Array.isArray(rawClaims)) return null
  const claims = rawClaims.filter(isClaim)

  const first = (types: string[]): string | undefined =>
    claims.find((claim) => types.includes(claim.typ) && claim.val !== '')?.val

  const id = first(ID_CLAIMS)
  if (!id) return null

  const email = first(EMAIL_CLAIMS) ?? ''
  return {
    id,
    name: first(NAME_CLAIMS) ?? email,
    email,
    groups: claims.filter((claim) => GROUP_CLAIMS.includes(claim.typ)).map((claim) => claim.val),
  }
}

/** Construye la cabecera con el mismo formato que Easy Auth. Para desarrollo y pruebas. */
export function encodePrincipal(user: AuthUser): string {
  const claims: Claim[] = [
    { typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: user.id },
    { typ: 'name', val: user.name },
    { typ: 'preferred_username', val: user.email },
    ...user.groups.map((group) => ({ typ: 'groups', val: group })),
  ]
  const principal = { auth_typ: 'aad', name_typ: 'name', role_typ: 'roles', claims }
  return Buffer.from(JSON.stringify(principal), 'utf8').toString('base64')
}
