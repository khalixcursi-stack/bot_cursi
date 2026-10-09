export class UserError extends Error {
  constructor(message, options = {}) {
    super(message, options)
    this.name = 'UserError'
    this.userFacing = true
  }
}

export function asUserError(error, fallback) {
  if (error?.userFacing) return error
  const detail = String(error?.message || '').replace(/\s+/g, ' ').trim().slice(0, 220)
  return new UserError(detail ? `${fallback} (${detail})` : fallback, { cause: error })
}
